module.exports = {
  apps: [
    {
      name: "tiktok4k-bot",
      script: "node_modules/tsx/dist/cli.cjs",
      args: "src/bot.ts",
      interpreter: "node",
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
      script: "node_modules/tsx/dist/cli.cjs",
      args: "src/worker.ts",
      interpreter: "node",
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
