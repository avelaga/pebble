const bcrypt = require("bcryptjs");
const readline = require("readline");
const { spawnSync } = require("child_process");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      const stdin = process.openStdin();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = "";
      process.stdin.on("data", (char) => {
        char = char.toString();
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(input);
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007f") {
          if (input.length > 0) input = input.slice(0, -1);
        } else {
          input += char;
        }
      });
    } else {
      rl.question(question, resolve);
    }
  });
}

async function main() {
  console.log("Pebble — Reset Password\n");

  let password;
  while (true) {
    password = await prompt("New password: ", true);
    if (!password) {
      console.error("Password cannot be empty.");
      continue;
    }
    const confirm = await prompt("Confirm password: ", true);
    if (password !== confirm) {
      console.error("Passwords do not match. Try again.");
      continue;
    }
    break;
  }

  rl.close();

  console.log("Hashing password...");
  const hash = bcrypt.hashSync(password, 10);

  console.log("Updating Cloudflare Worker secret...");
  const result = spawnSync("npx", ["wrangler", "secret", "put", "EDITOR_PASSWORD_HASH"], {
    input: hash + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    console.error("\nFailed to update secret. Make sure you're logged in to Wrangler.");
    process.exit(1);
  }
  console.log("\nPassword reset successfully.");
}

main();
