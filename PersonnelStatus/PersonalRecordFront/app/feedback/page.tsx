import { FeedbackChat } from "@/features/feedback-chat";
import { DashboardLayout } from "@/components/dashboard-layout";

export default function FeedbackPage() {
  return (
    <DashboardLayout>
      <div className="container py-10 h-[calc(100vh-4rem)] flex flex-col">
        <h1 className="text-3xl font-bold mb-6">Обратная связь</h1>
        <div className="flex-1 min-h-0">
          <FeedbackChat />
        </div>
      </div>
    </DashboardLayout>
  );
}
