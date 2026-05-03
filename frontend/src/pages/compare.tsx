import Head from "next/head";

export default function ComparePage() {
  return (
    <>
      <Head>
        <title>Before/After · ThermalOS</title>
      </Head>
      <h1 className="mt-0 text-2xl font-semibold">Before/After</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Two date pickers, KPI cards, side-by-side BarChart land in a later PR.
      </p>
    </>
  );
}
