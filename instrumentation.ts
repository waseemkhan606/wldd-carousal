export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapAuth } = await import("./lib/auth/store");
    bootstrapAuth();
  }
}
