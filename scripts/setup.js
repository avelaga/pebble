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
const ADMIN_DIR = path.join(ROOT_DIR, "admin");

const DRY_RUN = process.argv.includes("--dry-run");

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
  if (DRY_RUN) {
    console.log(`  [dry-run] ${cmd}`);
    return "";
  }
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

function setSecret(name, value) {
  if (DRY_RUN) {
    console.log(`  [dry-run] wrangler secret put ${name}`);
    return;
  }
  const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd: API_DIR,
    input: value + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Failed to set secret: ${name}`);
}

function setVercelEnv(key, value, cwd = ADMIN_DIR) {
  if (DRY_RUN) {
    console.log(`  [dry-run] vercel env add ${key} production`);
    return;
  }
  const result = spawnSync("vercel", ["env", "add", key, "production"], {
    cwd,
    input: value + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`Failed to set Vercel env: ${key}`);
}

function writeFile(filePath, content) {
  if (DRY_RUN) {
    console.log(`  [dry-run] write ${path.relative(ROOT_DIR, filePath)}:`);
    console.log(content.split("\n").map((l) => `    ${l}`).join("\n"));
    return;
  }
  fs.writeFileSync(filePath, content);
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
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
    const body = JSON.stringify({ rootDirectory: "admin" });
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
  console.log(DRY_RUN ? "\n-- Pebble setup (dry run) --\n" : "\n-- Pebble setup --\n");

  // Parse optional --prefix argument
  const prefixArg = process.argv.find((a) => a.startsWith("--prefix="));
  const prefix = prefixArg ? prefixArg.split("=")[1] : "pebble";

  const defaultWorkerName = `${prefix}-cms-api`;
  const defaultDbName = `${prefix}-cms-db`;
  const defaultBucketName = `${prefix}-cms-images`;
  const defaultAdminName = `${prefix}-cms-admin`;

  // Install API dependencies
  if (!DRY_RUN) {
    console.log("Installing API dependencies...");
    execSync("npm install", { cwd: API_DIR, stdio: "inherit" });
    console.log("Installing admin dependencies...");
    execSync("npm install", { cwd: ADMIN_DIR, stdio: "inherit" });
  }

  // Check Wrangler auth
  console.log("\nChecking Wrangler authentication...");
  try {
    execSync("npx wrangler whoami", {
      cwd: API_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
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
  const adminName = (await prompt(`  Vercel project    [${defaultAdminName}]: `)) || defaultAdminName;

  validateResourceName(workerName);
  validateResourceName(dbName);
  validateResourceName(bucketName);
  validateResourceName(adminName);

  // Create D1 database
  console.log(`\nCreating D1 database "${dbName}"...`);
  let dbId;
  if (DRY_RUN) {
    console.log(`  [dry-run] wrangler d1 create ${dbName}`);
    dbId = "<generated-by-cloudflare>";
  } else {
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
    dbId = dbIdMatch[1];
    console.log(`Database ID: ${dbId}`);
  }

  // Create R2 bucket
  console.log(`\nCreating R2 bucket "${bucketName}"...`);
  run(`npx wrangler r2 bucket create ${bucketName}`);
  if (!DRY_RUN) console.log("Bucket created.");

  // R2 public URL
  let r2PublicUrl;
  if (DRY_RUN) {
    r2PublicUrl = "https://pub-<YOUR_BUCKET_ID>.r2.dev";
    console.log(`\n  [dry-run] skipping R2 public URL prompt (placeholder: ${r2PublicUrl})`);
  } else {
    console.log("\nEnable R2 public access (required for image uploads):");
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
  if (!DRY_RUN) fs.copyFileSync(tomlExamplePath, tomlPath);
  let toml = DRY_RUN ? fs.readFileSync(tomlExamplePath, "utf8") : fs.readFileSync(tomlPath, "utf8");
  toml = toml
    .replace(/^name = ".*"$/m, `name = "${workerName}"`)
    .replace(/^database_name = ".*"$/m, `database_name = "${dbName}"`)
    .replace(/^database_id = ".*"$/m, `database_id = "${dbId}"`)
    .replace(/^bucket_name = ".*"$/m, `bucket_name = "${bucketName}"`)
    .replace(/^R2_PUBLIC_URL = ".*"$/m, `R2_PUBLIC_URL = "${r2PublicUrl}"`);
  writeFile(tomlPath, toml);

  // Apply schema
  console.log("\nApplying database schema...");
  if (DRY_RUN) {
    console.log(`  [dry-run] wrangler d1 execute ${dbName} --remote --file=schema.sql`);
  } else {
    execSync(`npx wrangler d1 execute ${dbName} --remote --file=schema.sql`, {
      cwd: API_DIR,
      stdio: "inherit",
    });
  }

  // Admin credentials
  console.log("\nCreate your admin account:");
  const adminUsername = await prompt("Username: ");
  let adminPassword;
  if (DRY_RUN) {
    adminPassword = "dry-run-password";
    console.log("  [dry-run] skipping password prompts");
  } else {
    while (true) {
      adminPassword = await prompt("Password: ");
      const adminPasswordConfirm = await prompt("Confirm password: ");
      if (adminPassword === adminPasswordConfirm) break;
      console.log("  Passwords do not match. Try again.");
    }
  }

  // Hash password
  let passwordHash;
  if (DRY_RUN) {
    passwordHash = "<bcrypt-hash-of-password>";
    console.log("  [dry-run] skipping password hash");
  } else {
    const hashResult = spawnSync("node", ["scripts/hash-password.js", adminPassword], {
      cwd: API_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    if (hashResult.status !== 0) {
      console.error("Failed to hash password:", hashResult.stderr);
      process.exit(1);
    }
    passwordHash = hashResult.stdout.trim();
  }

  // Generate JWT secret
  const jwtSecret = DRY_RUN ? "<random-32-byte-hex>" : crypto.randomBytes(32).toString("hex");

  // Set Cloudflare secrets
  console.log("\nSetting Cloudflare secrets...");
  setSecret("JWT_SECRET", jwtSecret);
  setSecret("ADMIN_USERNAME", adminUsername);
  setSecret("ADMIN_PASSWORD_HASH", passwordHash);

  // Deploy Worker
  console.log("\nDeploying Worker...");
  let workerUrl;
  if (DRY_RUN) {
    console.log("  [dry-run] wrangler deploy");
    workerUrl = `https://${workerName}.<your-account>.workers.dev`;
  } else {
    let deployOutput;
    try {
      deployOutput = run("npx wrangler deploy");
      process.stdout.write(deployOutput);
    } catch (e) {
      console.error("Deploy failed:", e.stderr || e.message);
      process.exit(1);
    }
    const urlMatch = stripAnsi(deployOutput).match(/https:\/\/[^\s]+\.workers\.dev/);
    workerUrl = urlMatch ? urlMatch[0] : null;
  }

  // Write admin/.env.local
  const envPath = path.join(ADMIN_DIR, ".env.local");
  if (workerUrl && (DRY_RUN || !fs.existsSync(envPath))) {
    writeFile(envPath, `NEXT_PUBLIC_API_URL=${workerUrl}\n`);
    if (!DRY_RUN) console.log("\nCreated admin/.env.local");
  }

  // Deploy admin to Vercel (initial deploy to create the project)
  console.log("\nDeploying admin to Vercel...");
  console.log("  Note: you may be prompted to select your Vercel account on first deploy.");
  let vercelUrl;
  if (DRY_RUN) {
    console.log(`  [dry-run] vercel deploy --prod --yes --name ${adminName}`);
    vercelUrl = `https://${adminName}.vercel.app`;
  } else {
    let vercelOutput;
    try {
      vercelOutput = execSync(`vercel deploy --prod --yes --name ${adminName}`, {
        cwd: ADMIN_DIR,
        encoding: "utf8",
        stdio: ["inherit", "pipe", "pipe"],
      });
      process.stdout.write(vercelOutput);
    } catch (e) {
      console.error("Vercel deploy failed:", e.stderr || e.message);
      process.exit(1);
    }
    const urlMatch = stripAnsi(vercelOutput).match(/https:\/\/[^\s]+\.vercel\.app/);
    vercelUrl = urlMatch ? urlMatch[0] : null;
    if (vercelUrl) console.log(`Vercel URL: ${vercelUrl}`);
  }

  // Set root directory to admin/ so Git-triggered deploys build from the right place
  console.log("\nConfiguring Vercel root directory...");
  if (DRY_RUN) {
    console.log("  [dry-run] PATCH /v9/projects/{projectId} rootDirectory=admin");
  } else {
    try {
      const vercelProjectJson = path.join(ADMIN_DIR, ".vercel", "project.json");
      const { projectId } = JSON.parse(fs.readFileSync(vercelProjectJson, "utf8"));
      const token = getVercelToken();
      if (!token) throw new Error("Could not find Vercel auth token.");
      await setVercelRootDirectory(projectId, token);
      console.log("Root directory set to admin/.");
    } catch (e) {
      console.log(`  Could not set root directory automatically: ${e.message}`);
      console.log("  Set it manually in the Vercel dashboard: Project Settings -> General -> Root Directory -> admin");
    }
  }

  // Set NEXT_PUBLIC_API_URL on Vercel and redeploy
  if (workerUrl) {
    console.log("\nSetting Vercel environment variable...");
    setVercelEnv("NEXT_PUBLIC_API_URL", workerUrl);

    console.log("\nRedeploying admin to pick up env var...");
    if (DRY_RUN) {
      console.log(`  [dry-run] vercel deploy --prod --yes --name ${adminName}`);
    } else {
      try {
        const redeployOutput = execSync(`vercel deploy --prod --yes --name ${adminName}`, {
          cwd: ADMIN_DIR,
          encoding: "utf8",
          stdio: ["inherit", "pipe", "pipe"],
        });
        process.stdout.write(redeployOutput);
        // Use final URL from redeploy
        const finalUrlMatch = stripAnsi(redeployOutput).match(/https:\/\/[^\s]+\.vercel\.app/);
        if (finalUrlMatch) vercelUrl = finalUrlMatch[0];
      } catch (e) {
        console.error("Vercel redeploy failed:", e.stderr || e.message);
        process.exit(1);
      }
    }
  }

  // Connect GitHub repo to Vercel project for auto-deploy on push
  if (!DRY_RUN && vercelUrl) {
    console.log("\nLinking GitHub repo to Vercel for auto-deploy...");
    try {
      const remoteUrl = execSync("git remote get-url origin", { cwd: ROOT_DIR, encoding: "utf8" }).trim();
      const isGitHub = remoteUrl.includes("github.com");
      if (!isGitHub) {
        console.log("  Remote is not GitHub — skipping auto-link. Connect manually in the Vercel dashboard under Settings -> Git.");
      } else {
        // Check if the remote has been pushed
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
          console.log("  from the admin/ directory.");
        } else {
          execSync(`vercel git connect ${remoteUrl}`, { cwd: ADMIN_DIR, stdio: "inherit" });
          console.log("GitHub repo linked.");
        }
      }
    } catch {
      console.log("  Could not auto-link. Connect the repo manually in the Vercel dashboard under Settings -> Git.");
    }
  } else if (DRY_RUN) {
    console.log("\n  [dry-run] vercel git connect $(git remote get-url origin)");
  }

  // Ask for production admin URL (may differ from Vercel preview URL if using a custom domain)
  let prodAdminUrl = vercelUrl;
  if (!DRY_RUN && vercelUrl) {
    const customUrl = await prompt(`\nProduction admin URL (press enter to use ${vercelUrl}): `);
    if (customUrl) prodAdminUrl = customUrl;
  }

  // Update CORS_ORIGINS with admin URL and redeploy Worker
  if (prodAdminUrl) {
    console.log("\nUpdating CORS_ORIGINS...");
    let updatedToml = fs.readFileSync(tomlPath, "utf8");
    updatedToml = updatedToml.replace(/^CORS_ORIGINS = ".*"$/m, `CORS_ORIGINS = "${prodAdminUrl},http://localhost:3000"`);
    writeFile(tomlPath, updatedToml);

    console.log("\nRedeploying Worker with updated CORS...");
    run("npx wrangler deploy");
  }

  // Done
  console.log(DRY_RUN ? "\n-- Dry run complete (nothing was created) --" : "\n-- Setup complete --");
  if (workerUrl) console.log(`Worker:  ${workerUrl}`);
  if (prodAdminUrl) console.log(`Admin:   ${prodAdminUrl}`);
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
