resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["web", "worker", "migrate"])
  name              = "/projectos/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/projectos/${var.environment}/vpc-flow"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}

locals {
  image = { for k, r in aws_ecr_repository.app : k => "${r.repository_url}:${var.image_tag}" }
  common_env = [
    { name = "APP_MODE", value = var.app_mode },
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "DB_HOST", value = aws_db_instance.main.address },
    { name = "DB_PORT", value = tostring(aws_db_instance.main.port) },
    { name = "DB_NAME", value = aws_db_instance.main.db_name },
    { name = "DB_SSLMODE", value = "verify-full" },
    { name = "REQUIRE_MFA_FOR_PRIVILEGED", value = "true" },
    { name = "APP_VERSION", value = var.image_tag },
    { name = "GIT_SHA", value = var.image_tag },
  ]
  # Runtime tasks connect as the least-privilege application role (DML only; created by infra/sql/app-role.sql).
  app_db_secrets = [
    { name = "DB_USER", valueFrom = "${aws_secretsmanager_secret.app["db-app-password"].arn}:username::" },
    { name = "DB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app["db-app-password"].arn}:password::" },
  ]
  hardening = {
    readonlyRootFilesystem = true
    privileged             = false
    user                   = "node"
    linuxParameters        = { initProcessEnabled = true, capabilities = { drop = ["ALL"] } }
  }
  logs = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options   = { "awslogs-group" = g.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = k }
  } }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["web"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge(local.hardening, {
    # Next.js writes its cache under .next/cache at runtime. A read-only root with a scratch volume there is the
    # goal, but Fargate scratch-volume ownership for the non-root user is unverified — RC checklist item SEC-RO-FS.
    readonlyRootFilesystem = false
    name                   = "web"
    image                  = local.image["web"]
    essential              = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.common_env, [
      { name = "BETTER_AUTH_URL", value = "https://${var.domain_name}" },
      { name = "AUTH_SIGNIN_MAX_PER_MIN", value = "10" },
      { name = "TRUSTED_PROXY_CIDRS", value = var.vpc_cidr },
    ])
    secrets = concat(local.app_db_secrets, [
      { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.app["better-auth-secret"].arn },
    ])
    logConfiguration = local.logs["web"]
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  })])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["worker"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name             = "worker"
    image            = local.image["worker"]
    essential        = true
    environment      = concat(local.common_env, [{ name = "WORKER_POLL_MS", value = "15000" }])
    secrets          = local.app_db_secrets
    logConfiguration = local.logs["worker"]
  })])
}

# One-off release task (run by the deploy pipeline before rolling the services). Uses the RDS-managed master
# secret because migrations need DDL; the runtime services never receive it.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task["migrate"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name        = "migrate"
    image       = local.image["migrate"]
    essential   = true
    environment = local.common_env
    secrets = [
      { name = "DB_USER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
    ]
    logConfiguration = local.logs["migrate"]
  })])
}

resource "aws_ecs_service" "web" {
  name                               = "web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web.arn
  desired_count                      = var.web_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.app[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.https, terraform_data.phi_gate]
}

# Exactly one worker: the Postgres job queue is safe with more (SKIP LOCKED), but one keeps costs and logs simple.
resource "aws_ecs_service" "worker" {
  name                               = "worker"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.worker.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.app[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }
  depends_on = [terraform_data.phi_gate]
}
