module.exports = {
  apps: [{
    name: 'photo-server',
    script: 'npm',
    args: 'start',
    cwd: __dirname,
    interpreter: 'none',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    max_memory_restart: '1G'
  }]
};