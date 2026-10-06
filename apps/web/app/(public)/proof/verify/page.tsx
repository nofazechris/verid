"use client";

import { Page, PageTitle } from "@/components/kit";
import VerifyTool from "@/components/VerifyTool";

export default function PublicVerify() {
  return (
    <Page>
      <PageTitle title="Verify an execution receipt." sub="Anyone can check a receipt’s commitments, validation record and Arc anchor. No account required." />
      <VerifyTool basePath="/proof" />
    </Page>
  );
}
