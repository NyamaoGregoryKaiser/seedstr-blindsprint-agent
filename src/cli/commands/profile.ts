import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { SeedstrClient } from "../../api/client.js";
import { isRegistered, saveProfile, getStoredAgent } from "../../config/index.js";

interface ProfileOptions {
  name?: string;
  bio?: string;
  picture?: string;
}

export async function profileCommand(options: ProfileOptions): Promise<void> {
  // Check if registered
  if (!isRegistered()) {
    console.log(chalk.red("\n✗ Agent is not registered"));
    console.log(chalk.gray("  Run `npm run register` first"));
    process.exit(1);
  }

  console.log(chalk.cyan("\n👤 Agent Profile\n"));

  const client = new SeedstrClient();

  // If no options provided, show current profile and prompt for updates
  if (!options.name && !options.bio && !options.picture) {
    const spinner = ora("Fetching profile...").start();

    try {
      const agentInfo = await client.getMe();
      spinner.stop();

      console.log(chalk.white("Current Profile:"));
      console.log(chalk.gray("─".repeat(50)));
      console.log(chalk.white("  Name:     ") + chalk.cyan(agentInfo.name || "(not set)"));
      console.log(chalk.white("  Bio:      ") + chalk.gray(agentInfo.bio || "(not set)"));
      console.log(
        chalk.white("  Picture:  ") +
          chalk.gray(agentInfo.profilePicture || "(default)")
      );
      console.log(chalk.white("  Verified: ") + (agentInfo.verification.isVerified ? chalk.green("✓ Yes") : chalk.yellow("✗ No")));
      if (agentInfo.verification.ownerTwitter) {
        console.log(
          chalk.white("  Twitter:  ") +
            chalk.cyan(agentInfo.verification.ownerTwitter)
        );
      }
      console.log(chalk.gray("─".repeat(50)));

      console.log(chalk.white("\nStats:"));
      console.log(
        chalk.white("  Reputation:     ") + chalk.cyan(agentInfo.reputation)
      );
      console.log(
        chalk.white("  Jobs Completed: ") + chalk.cyan(agentInfo.jobsCompleted)
      );
      console.log(
        chalk.white("  Total Earnings: ") +
          chalk.green(`$${agentInfo.totalEarnings.toFixed(2)}`)
      );

      // Ask if user wants to update
      const { update } = await prompts({
        type: "confirm",
        name: "update",
        message: "Would you like to update your profile?",
        initial: false,
      });

      if (!update) {
        return;
      }

      // Prompt for new values
      const responses = await prompts([
        {
          type: "text",
          name: "name",
          message: "New name (leave empty to keep current):",
          initial: agentInfo.name || "",
        },
        {
          type: "text",
          name: "bio",
          message: "New bio (leave empty to keep current):",
          initial: agentInfo.bio || "",
        },
        {
          type: "text",
          name: "picture",
          message: "New profile picture URL (leave empty to keep current):",
          initial: agentInfo.profilePicture || "",
        },
      ]);

      options.name = responses.name || undefined;
      options.bio = responses.bio || undefined;
      options.picture = responses.picture || undefined;
    } catch (error) {
      spinner.fail("Failed to fetch profile");
      console.error(
        chalk.red("\nError:"),
        error instanceof Error ? error.message : "Unknown error"
      );
      process.exit(1);
    }
  }

  // Update profile if any options provided
  const updateData: { name?: string; bio?: string; profilePicture?: string } = {};
  if (options.name) updateData.name = options.name;
  if (options.bio) updateData.bio = options.bio;
  if (options.picture) updateData.profilePicture = options.picture;

  if (Object.keys(updateData).length === 0) {
    console.log(chalk.gray("No changes to make."));
    return;
  }

  const updateSpinner = ora("Updating profile...").start();

  try {
    const result = await client.updateProfile(updateData);
    updateSpinner.succeed("Profile updated!");

    // Save locally
    saveProfile(updateData);

    console.log(chalk.green("\n✓ Profile updated successfully!"));
    console.log(chalk.gray("─".repeat(50)));
    const agent = result?.agent;
    if (agent) {
      console.log(chalk.white("  Name:    ") + chalk.cyan(agent.name ?? "(not set)"));
      console.log(chalk.white("  Bio:     ") + chalk.gray(agent.bio ?? "(not set)"));
      console.log(
        chalk.white("  Picture: ") + chalk.gray(agent.profilePicture ?? "(default)")
      );
    } else {
      console.log(chalk.white("  Name:    ") + chalk.cyan(updateData.name ?? "(unchanged)"));
      console.log(chalk.white("  Bio:     ") + chalk.gray(updateData.bio ?? "(unchanged)"));
      if (updateData.profilePicture !== undefined) {
        console.log(chalk.white("  Picture: ") + chalk.gray(updateData.profilePicture || "(default)"));
      }
    }
    console.log(chalk.gray("─".repeat(50)));
  } catch (error) {
    updateSpinner.fail("Profile update failed");
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(chalk.red("\nError:"), message);
    if (message.toLowerCase().includes("invalid api key")) {
      console.log(
        chalk.gray(
          "\nTip: Check SEEDSTR_API_KEY in your .env file. Use the key from your Seedstr dashboard, or run `npm run register` again and paste the new API key into .env (no quotes, no extra spaces)."
        )
      );
    }
    process.exit(1);
  }
}
