# Pluto

Pluto is a modern, local-first AI chat interface built with Next.js 15, designed to provide a premium experience for interacting with cutting-edge LLMs. It focuses on privacy, speed, and advanced reasoning capabilities.

## ✨ Features

- **Advanced Model Support**: Access the latest models via **Google Gemini** and **Chutes.ai** (TEE-protected), including:
  - **Google**: Gemini 3 Flash, Gemini 2.5 Flash, Gemma 3.
  - **DeepSeek**: DeepSeek V3.2 (with TEE security).
  - **Qwen**: Qwen 3 (Thinking & Instruct variants).
  - **Other Top Models**: Kimi K2.5, MiniMax M2.1, GLM 4.7, and Hermes 4.
- **Visualized Reasoning**: specialized UI for "Thinking" models (like DeepSeek R1 and Gemini Flash Thinking), allowing you to expand/collapse the model's internal chain of thought.
- **Supabase-Powered History**: Your chat history is stored securely in **Supabase**. This ensures your conversations are available across devices and stay in sync in real-time.
- **Rich Text Rendering**:
  - **Markdown Support**: Full GFM (GitHub Flavored Markdown) support.
  - **LaTeX Math**: Beautifully renders mathematical equations using KaTeX.
  - **Syntax Highlighting**: Auto-detects and highlights code blocks.

- **Responsive Design**: Built with **Tailwind CSS v4** and **Shadcn UI** for a sleek, dark-mode-first aesthetic.

## 🧠 How it Works

Pluto operates as a client-heavy application with a lightweight API proxy.

### Data Flow
1.  **User Input**: You type a message and hit send.
2.  **Optimistic UI**: The message is immediately added to the UI and saved to **IndexedDB** locally.
3.  **API Request**: The client sends the chat history to the Next.js API route (`/api/chat`).
4.  **Provider Routing**: The API determines which provider to use (Google, Chutes, or OpenRouter) based on the selected model.
5.  **Stream Transformation**: The API establishes a stream with the LLM provider.
    -   It parses incoming chunks.
    -   It detects `<think>` tags (generic or provider-specific) and standardizes them into a `reasoning_content` field.
6.  **Real-time Update**: The client receives these standardized chunks and updates the message in real-time, separating "thought" from "response".

### Database
Pluto uses **Supabase** to manage `threads` and `messages`. This means:
-   **Sync**: Your conversations are synchronized across all your devices.
-   **Real-time**: The UI updates instantly when changes occur, powerd by Supabase Realtime.
-   **Persistence**: Your chats are safely stored in the cloud.

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **UI Library**: [React 19](https://react.dev/), [Shadcn UI](https://ui.shadcn.com/), [Tailwind CSS v4](https://tailwindcss.com/)
- **State/Database**: [Supabase](https://supabase.com/)
- **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai/docs), [Google GenAI SDK](https://github.com/google/google-api-nodejs-client), [OpenRouter SDK](https://openrouter.ai/docs)
- **Markdown/Math**: `react-markdown`, `rehype-katex`, `remark-math`

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ installed
- API Keys for the providers:
  - **[Google AI Studio](https://aistudio.google.com/)**: Required for Gemini models.
  - **[Chutes.ai](https://chutes.ai/)**: Required for DeepSeek, Qwen, Kimi, and other TEE models.
  - **[OpenRouter](https://openrouter.ai/)**: Optional, for other models.

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/pluto.git
    cd pluto
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    pnpm install
    ```

3.  **Set up Environment Variables**
    Create a `.env.local` file in the root directory and add your keys:

    ```env
    # Google Gemini (Required for Gemini models)
    GEMINI_API_KEY=your_google_api_key_here

    # Chutes.ai (Required for DeepSeek, Qwen, etc.)
    CHUTES_API_KEY=your_chutes_api_key_here

    # OpenRouter (Optional)
    OPENROUTER_API_KEY=your_openrouter_api_key_here

    # App URL (for OpenRouter identification)
    NEXT_PUBLIC_APP_URL=http://localhost:3000
    ```

4.  **Run the development server**
    ```bash
    npm run dev
    ```

5.  **Open the app**
    Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

[MIT](LICENSE)
