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

function setVercelEnv(key, value, cwd = EDITOR_DIR) {
  const result = spawnSync("vercel", ["env", "add", key, "production"], {
    cwd,
    input: value + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Failed to set Vercel env: ${key}`);
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

function getVercelToken() {
  const locations = [
    path.join(os.homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"), // macOS
    path.join(os.homedir(), ".local", "share", "com.vercel.cli", "auth.json"), // Linux
    path.join(os.homedir(), ".config", "com.vercel.cli", "auth.json"),
    path.join(os.homedir(), ".vercel", "auth.json"),
  ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        const data = JSON.parse(fs.readFileSync(loc, "utf8"));
        if (data.token) return data.token;
      } catch {}
    }
  }
  return null;
}

function setVercelRootDirectory(projectId, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ rootDirectory: "editor" });
    const req = https.request(
      {
        hostname: "api.vercel.com",
        path: `/v9/projects/${projectId}`,
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Vercel API ${res.statusCode}: ${data}`));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
    console.error("Not logged into Wrangler. Run: npx wrangler login");
    process.exit(1);
  }

  // Check Vercel auth
  console.log("\nChecking Vercel authentication...");
  try {
    execSync("vercel whoami", {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    console.log("Authenticated.");
  } catch {
    console.error("Not logged into Vercel. Run: vercel login");
    process.exit(1);
  }

  // Resource names
  console.log("\nResource names (press enter to use defaults):");
  const workerName = (await prompt(`  Cloudflare Worker [${defaultWorkerName}]: `)) || defaultWorkerName;
  const dbName = (await prompt(`  D1 database       [${defaultDbName}]: `)) || defaultDbName;
  const bucketName = (await prompt(`  R2 bucket         [${defaultBucketName}]: `)) || defaultBucketName;
  const editorName = (await prompt(`  Vercel project    [${defaultEditorName}]: `)) || defaultEditorName;

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

  // Update wrangler.toml
  console.log("\nUpdating wrangler.toml...");
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

  // Apply schema
  console.log("\nApplying database schema...");
  execSync(`npx wrangler d1 execute ${dbName} --remote --file=schema.sql`, {
    cwd: API_DIR,
    stdio: "inherit",
  });

  // Editor credentials
  console.log("\nCreate your editor account:");
  const editorUsername = await prompt("Username: ");
  let editorPassword;
  while (true) {
    editorPassword = await prompt("Password: ");
    const editorPasswordConfirm = await prompt("Confirm password: ");
    if (editorPassword === editorPasswordConfirm) break;
    console.log("  Passwords do not match. Try again.");
  }

  // Hash password
  const hashResult = spawnSync("node", ["scripts/hash-password.js", editorPassword], {
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
  setSecret("EDITOR_USERNAME", editorUsername);
  setSecret("EDITOR_PASSWORD_HASH", passwordHash);

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

  // Write editor/.env.local
  const envPath = path.join(EDITOR_DIR, ".env.local");
  if (workerUrl && !fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${workerUrl}\n`);
    console.log("\nCreated editor/.env.local");
  }

  // Deploy editor to Vercel (initial deploy to create the project)
  console.log("\nDeploying editor to Vercel...");
  console.log("  Note: you may be prompted to select your Vercel account on first deploy.");
  let vercelUrl;
  try {
    const vercelOutput = execSync(`vercel deploy --prod --yes --name ${editorName}`, {
      cwd: EDITOR_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    process.stdout.write(vercelOutput);
    const urlMatch = stripAnsi(vercelOutput).match(/https:\/\/[^\s]+\.vercel\.app/);
    vercelUrl = urlMatch ? urlMatch[0] : null;
    if (vercelUrl) console.log(`Vercel URL: ${vercelUrl}`);
  } catch (e) {
    console.error("Vercel deploy failed:", e.stderr || e.message);
    process.exit(1);
  }

  // Set NEXT_PUBLIC_API_URL on Vercel and redeploy
  if (workerUrl) {
    console.log("\nSetting Vercel environment variable...");
    setVercelEnv("NEXT_PUBLIC_API_URL", workerUrl);

    console.log("\nRedeploying editor to pick up env var...");
    try {
      const redeployOutput = execSync(`vercel deploy --prod --yes`, {
        cwd: EDITOR_DIR,
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"],
      });
      process.stdout.write(redeployOutput);
      const finalUrlMatch = stripAnsi(redeployOutput).match(/https:\/\/[^\s]+\.vercel\.app/);
      if (finalUrlMatch) vercelUrl = finalUrlMatch[0];
    } catch (e) {
      console.error("Vercel redeploy failed:", e.stderr || e.message);
      process.exit(1);
    }
  }

  // Set root directory to editor/ so Git-triggered deploys build from the right place.
  // Done after all CLI deploys to avoid Vercel resolving editor/editor for subsequent CLI runs.
  console.log("\nConfiguring Vercel root directory...");
  try {
    const vercelProjectJson = path.join(EDITOR_DIR, ".vercel", "project.json");
    const { projectId } = JSON.parse(fs.readFileSync(vercelProjectJson, "utf8"));
    const token = getVercelToken();
    if (!token) throw new Error("Could not find Vercel auth token.");
    await setVercelRootDirectory(projectId, token);
    console.log("Root directory set to editor/.");
  } catch (e) {
    console.log(`  Could not set root directory automatically: ${e.message}`);
    console.log("  Set it manually in the Vercel dashboard: Project Settings -> General -> Root Directory -> editor");
  }

  // Connect GitHub repo to Vercel project for auto-deploy on push
  if (vercelUrl) {
    console.log("\nLinking GitHub repo to Vercel for auto-deploy...");
    try {
      const remoteUrl = execSync("git remote get-url origin", { cwd: ROOT_DIR, encoding: "utf8" }).trim();
      const isGitHub = remoteUrl.includes("github.com");
      if (!isGitHub) {
        console.log("  Remote is not GitHub — skipping auto-link. Connect manually in the Vercel dashboard under Settings -> Git.");
      } else {
        let remotePushed = false;
        try {
          execSync("git ls-remote --exit-code origin HEAD", { cwd: ROOT_DIR, stdio: "pipe" });
          remotePushed = true;
        } catch {
          remotePushed = false;
        }
        if (!remotePushed) {
          console.log("  Warning: your GitHub repo does not appear to have been pushed yet.");
          console.log("  Push it first (git push -u origin main), then run:");
          console.log(`    vercel git connect ${remoteUrl}`);
          console.log("  from the editor/ directory.");
        } else {
          execSync(`vercel git connect ${remoteUrl}`, { cwd: EDITOR_DIR, stdio: "inherit" });
          console.log("GitHub repo linked.");
        }
      }
    } catch {
      console.log("  Could not auto-link. To set up auto-deploy on push:");
      console.log("  1. Connect GitHub to your Vercel account: vercel.com/account/integrations");
      console.log("  2. Then link the repo: Project Settings -> Git -> Connect Repository");
    }
  }

  // Ask for production editor URL (may differ from Vercel preview URL if using a custom domain)
  let prodEditorUrl = vercelUrl;
  if (vercelUrl) {
    const customUrl = await prompt(`\nProduction editor URL (press enter to use ${vercelUrl}): `);
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
  console.log("\nNext: enable the GitHub Action for automatic Worker deploys on push:");
  console.log("  1. Go to dash.cloudflare.com -> My Profile -> API Tokens -> Create Token");
  console.log("  2. Use the 'Edit Cloudflare Workers' template");
  console.log("  3. Add the token to your GitHub repo: Settings -> Secrets -> Actions");
  console.log("     Name: CLOUDFLARE_API_TOKEN");
  console.log("\nOptional: if you have a Vercel-hosted frontend that consumes this API,");
  console.log("create a deploy hook in its Vercel dashboard (Settings -> Git -> Deploy Hooks)");
  console.log("and set it as a secret on the Worker:");
  console.log("  cd api && npx wrangler secret put VERCEL_DEPLOY_HOOK");
  console.log("The API will trigger a rebuild whenever a post is published.");

  rl.close();
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message);
  rl.close();
  process.exit(1);
});
