#!/usr/bin/env node

const { execSync, spawnSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const os = require("os");

const ROOT_DIR = path.join(__dirname, "..");
const API_DIR = path.join(ROOT_DIR, "api");
const EDITOR_DIR = path.join(ROOT_DIR, "editor");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function validateResourceName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]*$/.test(name)) {
    console.error(`  Invalid name "${name}": must start with a letter or number and contain only letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }
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

function getCFToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const configPaths = [
    path.join(os.homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml"), // macOS
    path.join(os.homedir(), ".config", ".wrangler", "config", "default.toml"), // Linux / XDG
    path.join(os.homedir(), ".wrangler", "config", "default.toml"),
  ];
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const config = fs.readFileSync(configPath, "utf8");
        const match = config.match(/oauth_token\s*=\s*"([^"]+)"/);
        if (match) return match[1];
      } catch {}
    }
  }
  return null;
}

function cfApiRequest(apiPath, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: "api.cloudflare.com",
        path: `/client/v4${apiPath}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function enableR2PublicDomain(bucketName, accountId) {
  const token = getCFToken();
  if (!token || !accountId) return null;
  const result = await cfApiRequest(
    `/accounts/${accountId}/r2/buckets/${bucketName}/domains/managed`,
    token, "PUT", { enabled: true }
  );
  const domain = result?.result?.domain;
  return domain ? `https://${domain}` : null;
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 18)) {
    console.error(`Node.js 18.18 or higher is required (found ${process.versions.node}).`);
    console.error("Download the latest LTS from https://nodejs.org/");
    process.exit(1);
  }
}

async function main() {
  checkNodeVersion();
  console.log("\n-- Pebble setup --\n");

  // Parse optional --prefix argument
  const prefixArg = process.argv.find((a) => a.startsWith("--prefix="));
  const prefix = prefixArg ? prefixArg.split("=")[1] : "pebble";

  const defaultWorkerName = `${prefix}-pebble-api`;
  const defaultDbName = `${prefix}-pebble-db`;
  const defaultBucketName = `${prefix}-pebble-images`;
  const defaultEditorName = `${prefix}-pebble-editor`;

  // Install dependencies
  console.log("Installing API dependencies...");
  execSync("npm install", { cwd: API_DIR, stdio: "inherit" });
  console.log("Installing editor dependencies...");
  execSync("npm install", { cwd: EDITOR_DIR, stdio: "inherit" });

  // Check Wrangler auth
  console.log("\nChecking Wrangler authentication...");
  let cfAccountId;
  try {
    const whoamiOutput = execSync("npx wrangler whoami", {
      cwd: API_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    const accountIdMatch = stripAnsi(whoamiOutput).match(/[a-f0-9]{32}/);
    if (accountIdMatch) cfAccountId = accountIdMatch[0];
    console.log("Authenticated.");
  } catch {
    console.log("Not logged in. Opening Cloudflare login...");
    execSync("npx wrangler login", { cwd: API_DIR, stdio: "inherit" });
    try {
      const whoamiOutput = execSync("npx wrangler whoami", {
        cwd: API_DIR,
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });
      const accountIdMatch = stripAnsi(whoamiOutput).match(/[a-f0-9]{32}/);
      if (accountIdMatch) cfAccountId = accountIdMatch[0];
      console.log("Authenticated.");
    } catch {
      console.error("Authentication failed. Please run: npx wrangler login");
      process.exit(1);
    }
  }

  // Resource names
  console.log("\nResource names (press enter to use defaults):");
  const workerName = (await prompt(`  Cloudflare Worker        [${defaultWorkerName}]: `)) || defaultWorkerName;
  const dbName = (await prompt(`  D1 database              [${defaultDbName}]: `)) || defaultDbName;
  const bucketName = (await prompt(`  R2 bucket                [${defaultBucketName}]: `)) || defaultBucketName;
  const editorName = (await prompt(`  Cloudflare Pages project [${defaultEditorName}]: `)) || defaultEditorName;

  validateResourceName(workerName);
  validateResourceName(dbName);
  validateResourceName(bucketName);
  validateResourceName(editorName);

  // Create D1 database
  console.log(`\nCreating D1 database "${dbName}"...`);
  let dbId;
  try {
    const d1Output = run(`npx wrangler d1 create ${dbName}`);
    const dbIdMatch = stripAnsi(d1Output).match(/"?database_id"?\s*[=:]\s*"([^"]+)"/);
    if (!dbIdMatch) {
      console.error("Could not parse database ID from output:\n", d1Output);
      process.exit(1);
    }
    dbId = dbIdMatch[1];
    console.log(`Database ID: ${dbId}`);
  } catch (e) {
    console.log("Database may already exist, looking up existing ID...");
    try {
      const listOutput = run(`npx wrangler d1 list --json`);
      const cleaned = stripAnsi(listOutput);
      const jsonStart = cleaned.indexOf("[");
      const databases = JSON.parse(cleaned.slice(jsonStart));
      const db = databases.find((d) => d.name === dbName);
      if (!db) {
        console.error("Failed to create D1 database and could not find an existing one:", e.stderr || e.message);
        process.exit(1);
      }
      dbId = db.uuid || db.database_id;
      console.log(`Found existing database. ID: ${dbId}`);
    } catch (e2) {
      console.error("Failed to create D1 database:", e.stderr || e.message);
      process.exit(1);
    }
  }

  // Create R2 bucket
  console.log(`\nCreating R2 bucket "${bucketName}"...`);
  try {
    run(`npx wrangler r2 bucket create ${bucketName}`);
    console.log("Bucket created.");
  } catch (e) {
    const errMsg = (e.stderr || e.stdout || e.message || "").toLowerCase();
    if (errMsg.includes("already exists") || errMsg.includes("conflict")) {
      console.log("Bucket already exists, continuing...");
    } else {
      console.error("Failed to create R2 bucket:", e.stderr || e.message);
      process.exit(1);
    }
  }

  // R2 public URL
  console.log(`\nEnabling R2 public access for "${bucketName}"...`);
  let r2PublicUrl;
  try {
    r2PublicUrl = await enableR2PublicDomain(bucketName, cfAccountId);
  } catch {}
  if (r2PublicUrl) {
    console.log(`R2 public URL: ${r2PublicUrl}`);
  } else {
    console.log("Could not enable automatically. Enable it manually:");
    console.log(`  1. Cloudflare Dashboard -> R2 -> ${bucketName} -> Settings`);
    console.log("  2. Under 'Public Development URL', click Enable");
    console.log("  3. Copy the URL (https://pub-xxxx.r2.dev)");
    r2PublicUrl = await prompt("\nR2 public URL: ");
    if (!r2PublicUrl.startsWith("https://")) {
      console.error("Invalid URL. Must start with https://");
      process.exit(1);
    }
  }

  // Update api/wrangler.toml
  console.log("\nUpdating api/wrangler.toml...");
  const tomlPath = path.join(API_DIR, "wrangler.toml");
  const tomlExamplePath = tomlPath + ".example";
  fs.copyFileSync(tomlExamplePath, tomlPath);
  let toml = fs.readFileSync(tomlPath, "utf8");
  toml = toml
    .replace(/^name = ".*"$/m, `name = "${workerName}"`)
    .replace(/^database_name = ".*"$/m, `database_name = "${dbName}"`)
    .replace(/^database_id = ".*"$/m, `database_id = "${dbId}"`)
    .replace(/^bucket_name = ".*"$/m, `bucket_name = "${bucketName}"`)
    .replace(/^R2_PUBLIC_URL = ".*"$/m, `R2_PUBLIC_URL = "${r2PublicUrl}"`);
  fs.writeFileSync(tomlPath, toml);

  // Update editor/wrangler.toml
  console.log("Updating editor/wrangler.toml...");
  const editorTomlPath = path.join(EDITOR_DIR, "wrangler.toml");
  fs.copyFileSync(editorTomlPath + ".example", editorTomlPath);
  let editorToml = fs.readFileSync(editorTomlPath, "utf8");
  editorToml = editorToml
    .replace(/^name = ".*"$/m, `name = "${editorName}"`)
    .replace(/^service = ".*"$/m, `service = "${editorName}"`);
  fs.writeFileSync(editorTomlPath, editorToml);

  // Apply schema
  console.log("\nApplying database schema...");
  execSync(`npx wrangler d1 execute ${dbName} --remote --file=schema.sql`, {
    cwd: API_DIR,
    stdio: "inherit",
  });

  // Editor credentials
  console.log("\nCreate your editor account:");
  const editorUsername = await prompt("Username: ");

  // Set password (hashes and pushes to Cloudflare)
  const passwordResult = spawnSync("node", ["scripts/reset-password.js"], {
    cwd: API_DIR,
    stdio: "inherit",
  });
  if (passwordResult.status !== 0) process.exit(1);

  // Generate JWT secret
  const jwtSecret = crypto.randomBytes(32).toString("hex");

  // Set Cloudflare secrets
  console.log("\nSetting Cloudflare secrets...");
  setSecret("JWT_SECRET", jwtSecret);
  setSecret("EDITOR_USERNAME", editorUsername);

  // Deploy Worker
  console.log("\nDeploying Worker...");
  let workerUrl;
  try {
    const deployOutput = run("npx wrangler deploy");
    process.stdout.write(deployOutput);
    const urlMatch = stripAnsi(deployOutput).match(/https:\/\/[^\s]+\.workers\.dev/);
    workerUrl = urlMatch ? urlMatch[0] : null;
  } catch (e) {
    console.error("Deploy failed:", e.stderr || e.message);
    process.exit(1);
  }

  // Write editor/.env.local with Worker URL (baked in at build time)
  const envPath = path.join(EDITOR_DIR, ".env.local");
  if (workerUrl) {
    fs.writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${workerUrl}\n`);
    console.log("\nCreated editor/.env.local");
  }

  // Build editor
  console.log("\nBuilding editor for Cloudflare Workers...");
  try {
    execSync("npm run cf:build", {
      cwd: EDITOR_DIR,
      stdio: "inherit",
    });
  } catch (e) {
    console.error("Editor build failed:", e.message);
    process.exit(1);
  }

  // Deploy editor to Cloudflare Workers
  console.log("\nDeploying editor to Cloudflare Workers...");
  let editorUrl;
  try {
    const editorDeployOutput = execSync("npx wrangler deploy", {
      cwd: EDITOR_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    process.stdout.write(editorDeployOutput);
    const urlMatch = stripAnsi(editorDeployOutput).match(/https:\/\/[^\s]+\.workers\.dev/);
    editorUrl = urlMatch ? urlMatch[0] : null;
    if (editorUrl) console.log(`Editor URL: ${editorUrl}`);
  } catch (e) {
    console.error("Editor deploy failed:", e.stderr || e.message);
    process.exit(1);
  }

  // Ask for production editor URL (may differ if using a custom domain)
  let prodEditorUrl = editorUrl;
  if (editorUrl) {
    const customUrl = await prompt(`\nProduction editor URL (press enter to use ${editorUrl}): `);
    if (customUrl) {
      if (!customUrl.startsWith("https://") && !customUrl.startsWith("http://")) {
        prodEditorUrl = "https://" + customUrl;
      } else {
        prodEditorUrl = customUrl;
      }
    }
  }

  // Update CORS_ORIGINS with editor URL and redeploy Worker
  if (prodEditorUrl) {
    console.log("\nUpdating CORS_ORIGINS...");
    let updatedToml = fs.readFileSync(tomlPath, "utf8");
    updatedToml = updatedToml.replace(/^CORS_ORIGINS = ".*"$/m, `CORS_ORIGINS = "${prodEditorUrl},http://localhost:3000"`);
    fs.writeFileSync(tomlPath, updatedToml);

    console.log("\nRedeploying Worker with updated CORS...");
    run("npx wrangler deploy");
  }

  // Done
  console.log("\n-- Setup complete --");
  if (workerUrl) console.log(`Worker:  ${workerUrl}`);
  if (prodEditorUrl) console.log(`Editor:  ${prodEditorUrl}`);

  console.log("\nOptional: trigger a frontend rebuild when a post is published.");
  console.log("Create a deploy hook in your Cloudflare Pages, Vercel, or Netlify project, then:");
  console.log("  cd api && npx wrangler secret put DEPLOY_HOOK");

  rl.close();
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message);
  rl.close();
  process.exit(1);
});
