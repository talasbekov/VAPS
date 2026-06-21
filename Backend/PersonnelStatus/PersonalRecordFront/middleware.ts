export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employees/:path*",
    "/organization/:path*",
    "/statuses/:path*",
  ],
};
