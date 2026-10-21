import { ErrorState } from "@projectos/ui";

export function Forbidden({ what = "this page" }: { what?: string }) {
  return <ErrorState title={`You don’t have access to ${what}`} message="Your role doesn’t include this permission. Ask an administrator if you need it." />;
}
