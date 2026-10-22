"use client";
import { Button } from "@projectos/ui";

export function PrintButton() {
  return (
    <Button className="print:hidden" onClick={() => window.print()}>
      Print paper schedule
    </Button>
  );
}
