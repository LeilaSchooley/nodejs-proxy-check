const { checkProxy, checkProxiesFromFile } = require("./index");

async function run() {
  console.log("Checking a single proxy...");
  const single = await checkProxy("127.0.0.1", 8080, {
    url: "https://httpbin.org/ip",
    timeout: 5000,
    type: "http",
    username: "user",
    password: "pass",
  });
  console.log(single);

  console.log("\nChecking proxies from proxies.txt...");
  const results = await checkProxiesFromFile("proxies.txt", {
    url: "https://httpbin.org/ip",
    timeout: 8000,
    concurrency: 5,
  });
  console.log(results);
}

run().catch((err) => {
  console.error("Error running example:", err);
  process.exit(1);
});
