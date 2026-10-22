export function PlayfulTitle({ text }: { text: string }) {
  return <h1 className="playful-title" aria-label={text}>
    {text.toUpperCase().split(" ").map((word, index) => <span className="playful-word" key={index} aria-hidden="true">
      {Array.from(word).map((letter, index) => <span key={index}>{letter}</span>)}
    </span>)}
  </h1>;
}
