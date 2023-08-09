const { default: axios } = require("axios");

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
    const repoFullName = context.payload.repository.full_name;
    const repoOwner = pr.base.repo.owner.login;
    const repoName = pr.base.repo.name;

    // Fetch main body for the pull request
    const conversationBody = await context.octokit.pulls.get({
      owner: repoOwner,
      repo: repoName,
      pull_number: pr.number,
    });

    // Check for /execute command in main body
    const conversationBodyHasCommand =
      conversationBody.data.body.includes("/execute");

    // Fetch comments on the pull request
    const comments = await context.octokit.issues.listComments({
      owner: repoOwner,
      repo: repoName,
      issue_number: pr.number,
    });

    // Check for /execute command in comments
    const executeComments = comments.data
      .filter((comment) => comment.body.includes("/execute"))
      .map((comment) => comment.user.login);

    // Fetch commits associated with the pull request
    const commits = await context.octokit.pulls.listCommits({
      owner: repoOwner,
      repo: repoName,
      pull_number: pr.number,
    });

    const executeCommits = commits.data.filter((commit) =>
      commit.commit.message.includes("/execute")
    );

    if (
      conversationBodyHasCommand ||
      executeComments.length > 0 ||
      executeCommits.length > 0
    ) {
      // Fetch the code from the pull request
      const response = await context.octokit.pulls.listFiles({
        owner: repoOwner,
        repo: repoName,
        pull_number: pr.number,
      });

      const codeFiles = response.data.filter(
        (file) => file.filename.endsWith(".js") // Assuming JavaScript files for demonstration
      );

      // Execute code using the emkc.org API
      const executionResults = await Promise.all(
        codeFiles.map(async (file) => {
          const contentResponse = await context.octokit.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: file.filename,
            ref: pr.head.ref, // Use the pull request's head ref to get the latest code
          });

          const code = Buffer.from(
            contentResponse.data.content,
            "base64"
          ).toString();
          let response = '';
          try{
            response = await axios.post(
              "https://emkc.org/api/v2/piston/execute",
              {
                language: "javascript",
                version: "1.32.3",
                aliases: ["deno-js"],
                runtime: "deno",
                files: [
                  {
                    name: file.filename,
                    content: code,
                  },
                ],
              }
            );
          }catch(err){
            console.log(err);
          }
          return response.data.run.stdout || response.data.run.stderr;
        })
      );

      // Post the execution results as a comment on the pull request
      const resultsComment = context.issue({
        body: "Execution Results:\n\n" + executionResults.join("\n\n"),
      });

      return context.octokit.issues.createComment(resultsComment);
    }
  });

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
