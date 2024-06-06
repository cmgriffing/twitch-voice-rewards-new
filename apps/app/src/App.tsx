import { useRef, useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";

function App() {
  const audioRef = useRef<HTMLAudioElement>(null);

  return (
    <>
      <h1>Vite + React</h1>
      <div className="card">
        <button
          onClick={async () => {
            const response = await fetch("http://localhost:8787/prompt", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: "Make up lyrics to a folk song.",
                userName: "foo",
                voiceProvider: "deepgram",
                voiceId: "aura-astaria-en",
                generativeProvider: "openai",
                generativeModel: "gpt-3.5-turbo",
              }),
            });
          }}
        >
          Submit
        </button>
        <audio autoPlay ref={audioRef}></audio>
      </div>
    </>
  );
}

export default App;
