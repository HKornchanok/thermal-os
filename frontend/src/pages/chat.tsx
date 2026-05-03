import Head from "next/head";

export default function ChatPage() {
  return (
    <>
      <Head>
        <title>AI Assistant · ThermalOS</title>
      </Head>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mt-0 text-2xl font-semibold">AI Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anthropic-grounded chat lands as the bonus phase.
        </p>
      </div>
    </>
  );
}
