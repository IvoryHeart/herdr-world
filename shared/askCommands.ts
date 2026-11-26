/** A command word alone must never create a question or an owner alert. */
export function askQuestionHint(question: string): string | null {
  switch (question.trim().toLowerCase()) {
    case "ls":
    case "list":
      return "use `herdr-world ask ls` to list your questions";
    case "get":
    case "acknowledge":
      return "use `herdr-world ask get ID` to retrieve a question";
    case "answer":
      return 'use `herdr-world ask answer ID "ANSWER"` to answer a question';
    case "withdraw":
      return "use `herdr-world ask withdraw ID` or `herdr-world ask withdraw --key CAUSE`";
    case "help":
      return "use `herdr-world ask --help` for usage";
    default:
      return null;
  }
}
