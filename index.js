const { default: axios } = require("axios");
const supportedLanguages = require("./languages.json");

// Track the timestamp of the last API request
let lastApiRequestTime = 0;

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
module.exports = (app) => {
  // Your code here
  app.log.info("Yay, the app was loaded!");

  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    return context.octokit.issues.createComment(issueComment);
  });

  // Listen for pull request creation events
  app.on("pull_request.opened", async (context) => {
    const pr = context.payload.pull_request;
    const repoOwner = pr.base.repo.owner.login;
    const repoName = pr.base.repo.name;
  
    // Fetch main body for the pull request
    const conversationBody = await context.octokit.pulls.get({
      owner: repoOwner,
      repo: repoName,
      pull_number: pr.number,
    });
  
    // Check for /execute command in main body
    const conversationBodyHasCommand = conversationBody.data.body.includes("/execute");
  
    // Fetch commits associated with the pull request
    const commits = await context.octokit.pulls.listCommits({
      owner: repoOwner,
      repo: repoName,
      pull_number: pr.number,
    });
  
    const executeCommits = commits.data.filter((commit) =>
      commit.commit.message.includes("/execute")
    );
  
    if (conversationBodyHasCommand || executeCommits.length > 0) {
      // Fetch the code files for the pull request
      const response = await context.octokit.pulls.listFiles({
        owner: repoOwner,
        repo: repoName,
        pull_number: pr.number,
      });
  
      // Execute code using the emkc.org API for each file
      const executionResults = [];
  
      for (const file of response.data) {
        const fileExtension = file.filename.split(".").pop().toLowerCase();
        const selectedLanguage = supportedLanguages.find(
          (language) => language.aliases.includes(fileExtension)
        );
  
        if (!selectedLanguage) {
          continue; // Skip unsupported file extensions
        }
  
        // Handle rate limiting
        await handleRateLimit();
  
        const contentResponse = await context.octokit.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: file.filename,
          ref: pr.head.ref,
        });
  
        const code = Buffer.from(
          contentResponse.data.content,
          "base64"
        ).toString();
  
        try {
          const response = await axios.post(
            "https://emkc.org/api/v2/piston/execute",
            {
              language: selectedLanguage.language,
              version: selectedLanguage.version,
              aliases: selectedLanguage.aliases,
              runtime: selectedLanguage.runtime,
              files: [
                {
                  name: file.filename,
                  content: code,
                },
              ],
            }
          );
          executionResults.push(response.data.run.stdout || response.data.run.stderr || "");
        } catch (err) {
          console.log(err);
        }
      }
  
      if (executionResults.length > 0) {
        // Post the execution results as a comment on the pull request
        const resultsComment = context.issue({
          body: `Execution Results:\n\n${executionResults.join("\n\n")}`,
        });
  
        return context.octokit.issues.createComment(resultsComment);
      }
    }
  });
  
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};

async function handleRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastApiRequestTime;
  if (timeSinceLastRequest < 200) {
    // Wait for the remaining time before making the next request
    await new Promise((resolve) => setTimeout(resolve, 200 - timeSinceLastRequest));
  }
  lastApiRequestTime = Date.now();
}
