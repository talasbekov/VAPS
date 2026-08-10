// Обратная связь переписана целиком: легаси-чат (FeedbackChat, вечный опрос
// несуществующего /api/dictionaries/feedback/) удалён, раздел живёт на новом
// модуле §28 (/security-ops/feedback → /api/ops/feedback-requests/, срез J).
// Старый адрес остаётся редиректом: на него ведут закладки и старые ссылки.
import { redirect } from "next/navigation";

export default function FeedbackPage() {
  redirect("/security-ops/feedback");
}
