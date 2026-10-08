/**
 * OPEN — site publicly live. Re-enable password gate when Jonathan locks again.
 */
export async function onRequest(context) {
  return context.next();
}
