import { FlashQ } from "./src";

const client = new FlashQ({ host: "localhost", port: 6789, timeout: 5000 });

async function test() {
  console.log("Connecting...");
  await client.connect();
  console.log("Connected");

  console.log("Getting stats...");
  const stats = await client.stats();
  console.log("Stats:", stats);

  console.log("Pushing job...");
  const job = await client.push("test-tcp", { hello: "world" });
  console.log("Pushed job:", job.id);

  await client.close();
  console.log("Done");
}

test().catch(e => console.error("Error:", e.message));
