/** اهتزاز خفيف عند نجاح فعل — يُلاحَظ حتى إن كان الموظف لا ينظر للشاشة لحظتها. */
export function buzz(pattern: number | number[] = 20): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // بعض المتصفحات ترفض الاهتزاز خارج تفاعل مستخدم مباشر — لا يستحق كسر التدفّق.
  }
}
