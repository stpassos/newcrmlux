module.exports = {
  apps: [
    {
      name: "WorkerLux-1",
      script: "/opt/worker-lux-1/server.js",
      cwd: "/opt/worker-lux-1",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        DATA_DIR: "/opt/worker-lux-1/data",
      },
    },
    {
      name: "WorkerLux-2",
      script: "/opt/worker-lux-2/server.js",
      cwd: "/opt/worker-lux-2",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      restart_delay: 5000,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: "8081",
        DATA_DIR: "/opt/worker-lux-2/data",
      },
    },
  ],
};
