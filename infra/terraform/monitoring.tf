resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = aws_kms_key.logs.arn
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarms = {
    alb_5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 5, op = "GreaterThanThreshold", period = 300,
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }, desc = "Web tier returned 5xx (see runbook: web errors)"
    }
    unhealthy_targets = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold", period = 60,
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }, desc = "A web task fails /health/ready (DB unreachable or migrations missing)"
    }
    p95_latency = {
      namespace = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", threshold = 2, op = "GreaterThanThreshold", period = 300,
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }, desc = "p95 response time above the 2 s performance budget"
    }
    worker_down = {
      namespace = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", period = 300,
      dims      = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.worker.name }, desc = "Worker not running: reminders, EHR writes and hold release stop (holds keep blocking — no double booking)"
    }
    db_cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", period = 300,
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Database CPU high"
    }
    db_storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 2147483648, op = "LessThanThreshold", period = 300,
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Database free storage below 2 GiB"
    }
    db_connections = {
      namespace = "AWS/RDS", metric = "DatabaseConnections", stat = "Maximum", threshold = 150, op = "GreaterThanThreshold", period = 300,
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Connection count unusually high (pool leak?)"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  extended_statistic  = startswith(each.value.stat, "p") ? each.value.stat : null
  statistic           = startswith(each.value.stat, "p") ? null : each.value.stat
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  period              = each.value.period
  evaluation_periods  = 2
  treat_missing_data  = each.key == "worker_down" ? "breaching" : "notBreaching"
  dimensions          = each.value.dims
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Dead-lettered jobs/outbox events are visible in the app (Admin › Worker) and in the readiness checks; the worker
# logs `job.failed`/`outbox.failed` with dead=true — a metric filter turns that into an alarm without logging any payload.
resource "aws_cloudwatch_log_metric_filter" "dead_letters" {
  name           = "${local.name}-dead-letters"
  log_group_name = aws_cloudwatch_log_group.app["worker"].name
  pattern        = "{ ($.msg = \"job.failed\" || $.msg = \"outbox.failed\") && $.dead IS TRUE }"
  metric_transformation {
    name      = "DeadLetters"
    namespace = "ProjectOS/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  alarm_name          = "${local.name}-dead-letters"
  alarm_description   = "A job or outbox event was dead-lettered (runbook: dead letters)"
  namespace           = "ProjectOS/${var.environment}"
  metric_name         = "DeadLetters"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
