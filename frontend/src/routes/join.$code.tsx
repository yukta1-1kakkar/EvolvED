import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/join/$code")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/join-class", search: { code: params.code } });
  },
});
