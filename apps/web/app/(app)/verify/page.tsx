"use client";

import { Page, PageTitle } from "@/components/kit";
import VerifyTool from "@/components/VerifyTool";

export default function Verify() {
  return (
    <Page>
      <PageTitle title="Verify" sub="Check a receipt’s commitments, validation record and Arc anchor. Anyone can do this — no account required." />
      <VerifyTool basePath="/receipts" />
    </Page>
  );
}
