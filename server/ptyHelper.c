#include <errno.h>
#include <fcntl.h>
#include <pty.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

static ssize_t read_exact(int fd, unsigned char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t n = read(fd, buffer + offset, length - offset);
    if (n == 0) return -1;
    if (n < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    offset += (size_t)n;
  }
  return (ssize_t)offset;
}

static int write_all(int fd, const unsigned char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t n = write(fd, buffer + offset, length - offset);
    if (n < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    offset += (size_t)n;
  }
  return 0;
}

static uint32_t read_u32_be(const unsigned char *buffer) {
  return ((uint32_t)buffer[0] << 24)
    | ((uint32_t)buffer[1] << 16)
    | ((uint32_t)buffer[2] << 8)
    | (uint32_t)buffer[3];
}

static int set_window_size(int master_fd, int cols, int rows) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = (unsigned short)cols;
  ws.ws_row = (unsigned short)rows;
  return ioctl(master_fd, TIOCSWINSZ, &ws);
}

static int handle_frame(int master_fd, pid_t child_pid) {
  unsigned char header[5];
  if (read_exact(STDIN_FILENO, header, sizeof(header)) < 0) return -1;

  unsigned char type = header[0];
  uint32_t length = read_u32_be(header + 1);
  unsigned char *payload = NULL;
  if (length > 0) {
    payload = malloc(length + 1);
    if (!payload) return -1;
    if (read_exact(STDIN_FILENO, payload, length) < 0) {
      free(payload);
      return -1;
    }
    payload[length] = '\0';
  }

  if (type == 'i') {
    if (length > 0 && write_all(master_fd, payload, length) < 0) {
      free(payload);
      return -1;
    }
  } else if (type == 'r') {
    int cols = 0;
    int rows = 0;
    if (!payload || sscanf((const char *)payload, "%d %d", &cols, &rows) != 2 || cols < 2 || rows < 2) {
      free(payload);
      return -1;
    }
    if (set_window_size(master_fd, cols, rows) < 0) {
      free(payload);
      return -1;
    }
  } else if (type == 'c') {
    kill(child_pid, SIGHUP);
    free(payload);
    return -1;
  } else {
    free(payload);
    return -1;
  }

  free(payload);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: %s <cols> <rows> <command> [args...]\n", argv[0]);
    return 2;
  }

  int cols = atoi(argv[1]);
  int rows = atoi(argv[2]);
  if (cols < 2 || rows < 2) {
    fprintf(stderr, "invalid PTY size\n");
    return 2;
  }

  int master_fd = -1;
  int slave_fd = -1;
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = (unsigned short)cols;
  ws.ws_row = (unsigned short)rows;

  if (openpty(&master_fd, &slave_fd, NULL, NULL, &ws) < 0) {
    perror("openpty");
    return 1;
  }

  pid_t child_pid = fork();
  if (child_pid < 0) {
    perror("fork");
    return 1;
  }

  if (child_pid == 0) {
    close(master_fd);
    if (setsid() < 0) _exit(127);
    ioctl(slave_fd, TIOCSCTTY, 0);
    dup2(slave_fd, STDIN_FILENO);
    dup2(slave_fd, STDOUT_FILENO);
    dup2(slave_fd, STDERR_FILENO);
    if (slave_fd > STDERR_FILENO) close(slave_fd);
    setenv("TERM", "xterm-256color", 1);
    if (getenv("PS1") == NULL) setenv("PS1", "\\[\\e[1;92m\\][\\u@\\h:\\w]\\$\\[\\e[0m\\] ", 1);
    execvp(argv[3], &argv[3]);
    perror("execvp");
    _exit(127);
  }

  close(slave_fd);

  int exit_status = 0;
  unsigned char buffer[4096];
  for (;;) {
    int status = 0;
    pid_t waited = waitpid(child_pid, &status, WNOHANG);
    if (waited == child_pid) {
      if (WIFEXITED(status)) exit_status = WEXITSTATUS(status);
      else if (WIFSIGNALED(status)) exit_status = 128 + WTERMSIG(status);
      break;
    }

    fd_set read_fds;
    FD_ZERO(&read_fds);
    FD_SET(master_fd, &read_fds);
    FD_SET(STDIN_FILENO, &read_fds);
    int max_fd = master_fd > STDIN_FILENO ? master_fd : STDIN_FILENO;
    int selected = select(max_fd + 1, &read_fds, NULL, NULL, NULL);
    if (selected < 0) {
      if (errno == EINTR) continue;
      break;
    }

    if (FD_ISSET(master_fd, &read_fds)) {
      ssize_t n = read(master_fd, buffer, sizeof(buffer));
      if (n > 0) {
        if (write_all(STDOUT_FILENO, buffer, (size_t)n) < 0) break;
      } else if (n == 0 || (n < 0 && errno != EINTR)) {
        break;
      }
    }

    if (FD_ISSET(STDIN_FILENO, &read_fds)) {
      if (handle_frame(master_fd, child_pid) < 0) break;
    }
  }

  close(master_fd);
  kill(child_pid, SIGHUP);
  waitpid(child_pid, NULL, 0);
  return exit_status;
}
