import { useState, useEffect, useRef, useCallback } from "react";

// Define types for the Web Speech API since it might not be in the default TS lib
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
  onend: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // State, not derived from the ref: the recognizer is created after the first render, and a ref
  // change alone doesn't re-render, so callers would keep seeing "unsupported".
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "ja-JP";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        // We only care about the latest result for this use case mostly
        // But for continuous dictation we might want to append.
        // For the chat input, we usually want the current buffer.
        // If continuous is true, we accumulate?
        // Let's simplified: just return the current combined transcript
        // Logic: The scenario engine might want "Accumulated final + current interim"
        // But since we want to populate an input field, we might restart?

        // Actually, let's keep it simple: just set transcript to what we hear.
        // If it's continuous, `event.results` contains the history of this session.

        let currentText = "";
        for (let i = 0; i < event.results.length; ++i) {
          currentText += event.results[i][0].transcript;
        }
        // Japanese text never uses spaces for word separation or punctuation, but the
        // recognizer sometimes emits them (unclear whether they reflect real pauses) —
        // strip them so downstream exact-match comparisons (e.g. review's local kana
        // short-circuit) aren't defeated by whitespace the target text never has.
        setTranscript(currentText.replace(/\s+/g, ""));
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      setSupported(true);
    } else {
      console.warn("Speech Recognition API not supported in this browser.");
    }
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      setTranscript(""); // Clear previous transcript on start
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Failed to start recognition", e);
      }
    }
  }, [isListening]);

  const stop = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, [isListening]);

  const reset = useCallback(() => {
    setTranscript("");
    if (isListening) {
      stop();
    }
  }, [isListening, stop]);

  return {
    isListening,
    transcript,
    start,
    stop,
    reset,
    supported,
  };
}
