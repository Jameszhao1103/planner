import { createAppServer } from "./create-server.mjs";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";
const { server } = await createAppServer();

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT to run the planner on a different port.`);
  } else if (error?.code === "EPERM") {
    console.error(`Cannot listen on ${host}:${port}. Set HOST or PORT to an allowed local address.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Planner workspace running at http://${host}:${port}`);
});
