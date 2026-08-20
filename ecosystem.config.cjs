module.exports = {
  apps: [
    {
      name: "tiktok4k-bot",
      script: "src/bot.ts",
      interpreter: "node_modules/tsx/dist/cli.cjs",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tiktok4k-worker",
      script: "src/worker.ts",
      interpreter: "node_modules/tsx/dist/cli.cjs",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
