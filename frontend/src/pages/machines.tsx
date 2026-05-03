import Head from "next/head";

export default function MachinesPage() {
  return (
    <>
      <Head>
        <title>Machines · ThermalOS</title>
      </Head>
      <h1 className="mt-0 text-2xl font-semibold">Machines</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Machine grid + detail chart land in a later PR.
      </p>
    </>
  );
}
