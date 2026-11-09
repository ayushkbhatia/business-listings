import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /*
         The seller's catalogue import — board 11d — is read in the browser and
         posted as text by a server action, and the default 1 MB refuses a
         5,000-row sheet. 4 MB is under Vercel's 4.5 MB request ceiling, which
         is the real limit.

         **It is no longer the licence importer's limit.** Board 12a used to
         ride in this body too, and this number is where its ceiling came from:
         4 MB cut a register export at about 30,000 rows against a declared
         50,000, so the importer refused the file the feature exists for. T4.1
         moved it to object storage — the browser PUTs to a signed URL and the
         server stages from the bucket — so the only thing bounded by this is a
         catalogue, where 5,000 rows is the product's own limit rather than the
         transport's.
      */
      bodySizeLimit: "4mb",
    },
  },

  /*
     Board `1n` (D-ROUTE, D-ID). The design documents name the buyer's enquiry
     screens under `/account` — `/account/rfq/RFQ-8841`, `/account/enquiries/:id/
     compare`, `/account/enquiries/:id/accepted` — while every one of them has
     lived under `/enquiry/:id` since handoff 2, with the tracking page, the
     thread and the accept screen beside them. One record keeps one address; the
     documents' paths arrive at it rather than becoming a second.

     `RFQ-` and `ENQ-` are one sequence and one record: an RFQ is an enquiry with
     more than one recipient, and the reference every screen, message and export
     prints is `ENQ-`. A link carrying the other prefix is read as the same
     number rather than 404ing.

     Temporary (307): nothing outside this codebase has ever linked to these, and
     a permanent redirect is one no browser forgets if the answer changes.
     Query strings — a claim token, a sort — carry through.
  */
  async redirects() {
    return [
      { source: "/account/rfq/:prefix(RFQ|ENQ)-:number(\\d{1,12})", destination: "/enquiry/ENQ-:number/compare", permanent: false },
      { source: "/account/rfq/:id", destination: "/enquiry/:id/compare", permanent: false },
      { source: "/account/enquiries/:id/compare", destination: "/enquiry/:id/compare", permanent: false },
      { source: "/account/enquiries/:id/accepted", destination: "/enquiry/:id/accepted", permanent: false },
    ];
  },
};

export default nextConfig;
