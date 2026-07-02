import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Story } from "@/components/site/Story";
import { Capabilities } from "@/components/site/Capabilities";
import { CTA } from "@/components/site/CTA";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EvolvED - Education that evolves with every learner" },
      { name: "description", content: "EvolvED is an adaptive educational intelligence that understands learners, reasons about pedagogy, generates lessons in real time, and evolves its teaching strategies over time." },
      { property: "og:title", content: "EvolvED - Education that evolves with every learner" },
      { property: "og:description", content: "A living teaching intelligence that adapts to how you think, learn, and grow." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400;500;600&family=Lexend:wght@300;400;500&display=swap",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="relative overflow-x-clip">
      <Nav />
      <Hero />
      <Story />
      <Capabilities />
      <CTA />
      <Footer />
    </main>
  );
}
