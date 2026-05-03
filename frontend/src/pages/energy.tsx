import Head from "next/head";

export default function EnergyPage() {
  return (
    <>
      <Head>
        <title>Energy · ThermalOS</title>
      </Head>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mt-0 text-2xl font-semibold">Energy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Total/by-zone area chart, date nav, bucket toggle land in a later PR.
        </p>
      </div>
    </>
  );
}
