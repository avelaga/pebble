#!/usr/bin/env node

const { execSync, spawnSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.join(__dirname, "..");
const API_DIR = path.join(ROOT_DIR, "api");
const ADMIN_DIR = path.join(ROOT_DIR, "admin");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function run(cmd, cwd = API_DIR) {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

function setSecret(name, value) {
  const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd: API_DIR,
    input: value + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Failed to set secret: ${name}`);
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

async function main() {
  console.log("\n-- Pebble setup --\n");

  // Install API dependencies
  console.log("Installing API dependencies...");
  execSync("npm install", { cwd: API_DIR, stdio: "inherit" });

  // Check Wrangler auth
  console.log("\nChecking Wrangler authentication...");
  try {
    run("npx wrangler whoami");
    console.log("Authenticated.");
  } catch {
    console.error("Not logged into Wrangler. Run: npx wrangler login");
    process.exit(1);
  }

  // Resource names
  const dbName = (await prompt("\nD1 database name [pebble-cms-db]: ")) || "pebble-cms-db";
  const bucketName = (await prompt("R2 bucket name [pebble-cms-images]: ")) || "pebble-cms-images";

  // Create D1 database
  console.log(`\nCreating D1 database "${dbName}"...`);
  let d1Output;
  try {
    d1Output = run(`npx wrangler d1 create ${dbName}`);
  } catch (e) {
    console.error("Failed to create D1 database:", e.stderr || e.message);
    process.exit(1);
  }

  const dbIdMatch = stripAnsi(d1Output).match(/database_id\s*=\s*"([^"]+)"/);
  if (!dbIdMatch) {
    console.error("Could not parse database ID from output:\n", d1Output);
    process.exit(1);
  }
  const dbId = dbIdMatch[1];
  console.log(`Database ID: ${dbId}`);

  // Create R2 bucket
  console.log(`\nCreating R2 bucket "${bucketName}"...`);
  try {
    run(`npx wrangler r2 bucket create ${bucketName}`);
    console.log("Bucket created.");
  } catch (e) {
    console.error("Failed to create R2 bucket:", e.stderr || e.message);
    process.exit(1);
  }

  // R2 public URL requires manual dashboard step
  console.log("\nEnable R2 public access (required for image uploads):");
  console.log(`  1. Cloudflare Dashboard -> R2 -> ${bucketName} -> Settings -> Public Access`);
  console.log("  2. Allow access and copy the public URL (https://pub-xxxx.r2.dev)");
  const r2PublicUrl = await prompt("\nR2 public URL: ");
  if (!r2PublicUrl.startsWith("https://")) {
    console.error("Invalid URL. Must start with https://");
    process.exit(1);
  }

  // Update wrangler.toml
  console.log("\nUpdating wrangler.toml...");
  const tomlPath = path.join(API_DIR, "wrangler.toml");
  let toml = fs.readFileSync(tomlPath, "utf8");
  toml = toml
    .replace("your-d1-database-name", dbName)
    .replace("your-d1-database-id", dbId)
    .replace("your-r2-bucket-name", bucketName)
    .replace("https://pub-YOUR_R2_BUCKET_ID.r2.dev", r2PublicUrl);
  fs.writeFileSync(tomlPath, toml);

  // Apply schema
  console.log("\nApplying database schema...");
  execSync(`npx wrangler d1 execute ${dbName} --remote --file=schema.sql`, {
    cwd: API_DIR,
    stdio: "inherit",
  });

  // Admin credentials
  console.log("\nCreate your admin account:");
  const adminUsername = await prompt("Username: ");
  const adminPassword = await prompt("Password: ");

  // Hash password via existing script (avoids bcryptjs require path issues)
  const hashResult = spawnSync("node", ["scripts/hash-password.js", adminPassword], {
    cwd: API_DIR,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (hashResult.status !== 0) {
    console.error("Failed to hash password:", hashResult.stderr);
    process.exit(1);
  }
  const passwordHash = hashResult.stdout.trim();

  // Generate JWT secret
  const jwtSecret = crypto.randomBytes(32).toString("hex");

  // Set Cloudflare secrets
  console.log("\nSetting Cloudflare secrets...");
  setSecret("JWT_SECRET", jwtSecret);
  setSecret("ADMIN_USERNAME", adminUsername);
  setSecret("ADMIN_PASSWORD_HASH", passwordHash);

  // Deploy
  console.log("\nDeploying Worker...");
  let deployOutput;
  try {
    deployOutput = run("npx wrangler deploy");
    process.stdout.write(deployOutput);
  } catch (e) {
    console.error("Deploy failed:", e.stderr || e.message);
    process.exit(1);
  }

  // Extract worker URL from deploy output
  const urlMatch = stripAnsi(deployOutput).match(/https:\/\/[^\s]+\.workers\.dev/);
  const workerUrl = urlMatch ? urlMatch[0] : null;

  // Write admin/.env.local
  if (workerUrl) {
    const envPath = path.join(ADMIN_DIR, ".env.local");
    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${workerUrl}\n`);
      console.log("\nCreated admin/.env.local");
    }
  }

  // Done
  console.log("\n-- Setup complete --");
  if (workerUrl) console.log(`Worker: ${workerUrl}`);
  console.log("\nNext steps:");
  console.log("  1. Deploy admin/ to Vercel");
  console.log("  2. Add your Vercel URL to CORS_ORIGINS in api/wrangler.toml");
  console.log("  3. Redeploy: cd api && npx wrangler deploy");

  rl.close();
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message);
  rl.close();
  process.exit(1);
});
