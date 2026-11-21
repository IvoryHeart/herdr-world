/* Credential-free Claude/Codex stand-in. Real PTYs, argv and OSC status;
 * transcript parsing and handoff are World's production consumers. */
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc > 2 && strcmp(argv[1], "auth") == 0) {
    puts("{\"loggedIn\":true}");
    return 0;
  }
  if (argc > 2 && strcmp(argv[1], "login") == 0) {
    puts("Logged in using ChatGPT");
    return 0;
  }
  const char *app = strrchr(argv[0], '/');
  app = app ? app + 1 : argv[0];
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("\033]7501;state=idle:app=%s\033\\", app);
  char line[4096];
  while (fgets(line, sizeof(line), stdin))
    printf("\033]7501;state=%s:app=%s\033\\",
      strncmp(line, "work", 4) == 0 ? "working" : "idle", app);
  return 0;
}
