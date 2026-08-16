export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST method is allowed"
    });
  }

  try {
    const {
      deliveryPincode,
      weight = 0.5,
      cod = 1
    } = req.body || {};

    if (!deliveryPincode) {
      return res.status(400).json({
        success: false,
        error: "Delivery pincode required"
      });
    }

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;
    const pickupPincode =
      process.env.SHIPROCKET_PICKUP_PINCODE;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        error: "Shiprocket login details missing in Vercel"
      });
    }

    if (!pickupPincode) {
      return res.status(500).json({
        success: false,
        error: "SHIPROCKET_PICKUP_PINCODE missing in Vercel"
      });
    }

    /* -----------------------------
       1. Shiprocket Login
    ----------------------------- */

    const loginResponse = await fetch(
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      }
    );

    const loginData = await loginResponse.json();

    if (!loginResponse.ok || !loginData.token) {
      return res.status(401).json({
        success: false,
        error:
          loginData.message ||
          "Shiprocket login failed"
      });
    }

    /* -----------------------------
       2. Check Courier / Shipping Rate
    ----------------------------- */

    const params = new URLSearchParams({
      pickup_postcode: String(pickupPincode),
      delivery_postcode: String(deliveryPincode),
      weight: String(weight),
      cod: String(cod),
      declared_value: "0"
    });

    const rateResponse = await fetch(
      "https://apiv2.shiprocket.in/v1/external/courier/serviceability?" +
        params.toString(),
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${loginData.token}`
        }
      }
    );

    const rateData = await rateResponse.json();

    if (!rateResponse.ok) {
      return res.status(400).json({
        success: false,
        error:
          rateData.message ||
          "Shipping rate check failed"
      });
    }

    const couriers =
      rateData?.data?.available_courier_companies || [];

    if (!couriers.length) {
      return res.status(404).json({
        success: false,
        error:
          "Is pincode ke liye courier available nahi mila."
      });
    }

    /* Sabse kam shipping charge wala courier */

    const sorted = [...couriers].sort(
      (a, b) =>
        Number(a.freight_charge || 0) -
        Number(b.freight_charge || 0)
    );

    const best = sorted[0];

    return res.status(200).json({
      success: true,
      shipping_charge:
        Number(best.freight_charge || 0),
      courier_name:
        best.courier_name || "",
      estimated_delivery:
        best.etd || "",
      courier_id:
        best.courier_company_id || null
    });

  } catch (error) {
    console.error("Shiprocket API Error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Shiprocket server error"
    });
  }
}
