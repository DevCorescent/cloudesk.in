import type { Metadata } from "next";
import { GuestApp } from "@/components/chat/guest-app";
import { invitePreview } from "@/server/chat/guests";

// An invite to one Chat conversation for people outside the workspace: they
// type their name, an admin lets them in, and they chat — no account. Not
// indexed by search engines; the link itself is the secret.
type Props = { params: Promise<{ code: string }> };

async function load(code: string) {
  try {
    return (await invitePreview(code)).invite;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const invite = await load((await params).code);
  return { title: invite ? `Join ${invite.where} — ${invite.workspace}` : "Invite not found", robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function JoinChatPage({ params }: Props) {
  const { code } = await params;
  return <GuestApp code={code} invite={await load(code)} />;
}
