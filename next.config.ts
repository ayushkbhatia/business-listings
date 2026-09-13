import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /*
         Board 12a: a licence export is read in the browser and staged by a
         server action, and the default 1 MB refused an 8,000-row file — the
         number criterion 1 names — before any code of ours ran. 4 MB is under
         Vercel's 4.5 MB request ceiling, which is the real limit; the staging
         form states it and refuses a larger file before sending it.
      */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
