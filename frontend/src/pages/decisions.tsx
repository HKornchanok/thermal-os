import Head from "next/head";

export default function DecisionsPage() {
  return (
    <>
      <Head>
        <title>AI Decisions · ThermalOS</title>
      </Head>
      <h1 className="mt-0 text-2xl font-semibold">AI Decisions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        TanStack Table + filters + pagination land in a later PR.
      </p>
    </>
  );
}
