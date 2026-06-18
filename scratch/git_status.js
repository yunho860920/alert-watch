const { execSync } = require('child_process');

try {
    console.log("=== GIT STATUS ===");
    const status = execSync('git status', { encoding: 'utf8' });
    console.log(status);

    console.log("=== GIT LOG ===");
    const log = execSync('git log -n 5 --oneline', { encoding: 'utf8' });
    console.log(log);

    console.log("=== GIT REMOTE ===");
    const remote = execSync('git remote -v', { encoding: 'utf8' });
    console.log(remote);
} catch (error) {
    console.error("Error running git command:", error.message);
    if (error.stderr) console.error("Stderr:", error.stderr.toString());
    if (error.stdout) console.log("Stdout:", error.stdout.toString());
}
