import type { Metadata } from "next";
import { ChatbotView } from "@/components/chatbot/chatbot-view";

export const metadata: Metadata = { title: "Chatbot" };

export default async function Page({ params }: PageProps<"/projects/[projectId]/chatbot">) {
  const { projectId } = await params;
  return <ChatbotView projectId={projectId} />;
}
