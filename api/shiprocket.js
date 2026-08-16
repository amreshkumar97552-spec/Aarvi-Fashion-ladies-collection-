export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST method is allowed"
    });
  }

  try {
    const body = req.body || {};

    /*
    =========================================================
    SHIPROCKET LOGIN DETAILS
    Vercel Environment Variables:
      SHIPROCKET_EMAIL
      SHIPROCKET_PASSWORD
      SHIPROCKET_PICKUP_PINCODE
    =========================================================
    */

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

    /*
    =========================================================
    SHIPROCKET LOGIN
    =========================================================
    */

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

    const token = loginData.token;

    /*
    =========================================================
    ACTION
    =========================================================

    Default:
      rate = shipping charge

    Tracking:
      action = "track"
      awb = AWB number

    Or:
      action = "track"
      shipmentId = Shiprocket shipment ID
    */

    const action =
      String(body.action || "rate").toLowerCase();

    /*
    =========================================================
    1. SHIPPING RATE
    =========================================================
    */

    if (
      action === "rate" ||
      action === "shipping" ||
      action === "shipping_rate"
    ) {
      const {
        deliveryPincode,
        weight = 0.5,
        cod = 1,
        declaredValue = 0
      } = body;

      if (!deliveryPincode) {
        return res.status(400).json({
          success: false,
          error: "Delivery pincode required"
        });
      }

      if (!pickupPincode) {
        return res.status(500).json({
          success: false,
          error:
            "SHIPROCKET_PICKUP_PINCODE missing in Vercel"
        });
      }

      const params = new URLSearchParams({
        pickup_postcode: String(pickupPincode),
        delivery_postcode: String(deliveryPincode),
        weight: String(weight),
        cod: String(cod),
        declared_value: String(declaredValue || 0)
      });

      const rateResponse = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/serviceability?" +
          params.toString(),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );

      const rateData = await rateResponse.json();

      if (!rateResponse.ok) {
        return res.status(400).json({
          success: false,
          error:
            rateData.message ||
            rateData.error ||
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

      /*
      Lowest shipping charge courier
      */

      const sorted = [...couriers].sort(
        (a, b) =>
          Number(a.freight_charge || 0) -
          Number(b.freight_charge || 0)
      );

      const best = sorted[0];

      return res.status(200).json({
        success: true,
        type: "shipping_rate",

        shipping_charge:
          Number(best.freight_charge || 0),

        courier_name:
          best.courier_name || "",

        courier_id:
          best.courier_company_id || null,

        estimated_delivery:
          best.etd || "",

        cod_charges:
          Number(best.cod_charges || 0),

        rate:
          Number(best.rate || best.freight_charge || 0)
      });
    }

    /*
    =========================================================
    2. TRACKING
    =========================================================
    */

    if (
      action === "track" ||
      action === "tracking"
    ) {
      let awb =
        body.awb ||
        body.awb_code ||
        body.awbCode ||
        "";

      const shipmentId =
        body.shipmentId ||
        body.shipment_id ||
        "";

      /*
      -----------------------------------------
      If AWB is not supplied but shipment ID is
      supplied, get shipment details first.
      -----------------------------------------
      */

      if (!awb && shipmentId) {
        const shipmentResponse = await fetch(
          "https://apiv2.shiprocket.in/v1/external/shipments/" +
            encodeURIComponent(String(shipmentId)),
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`
            }
          }
        );

        const shipmentData =
          await shipmentResponse.json();

        if (!shipmentResponse.ok) {
          return res.status(400).json({
            success: false,
            error:
              shipmentData.message ||
              shipmentData.error ||
              "Shipment details nahi mile"
          });
        }

        /*
        Different Shiprocket response structures
        */

        awb =
          shipmentData?.data?.awb ||
          shipmentData?.data?.awb_code ||
          shipmentData?.data?.shipment?.awb ||
          shipmentData?.data?.shipment?.awb_code ||
          shipmentData?.awb ||
          shipmentData?.awb_code ||
          "";
      }

      /*
      -----------------------------------------
      AWB required
      -----------------------------------------
      */

      if (!awb) {
        return res.status(400).json({
          success: false,
          error:
            "Tracking ke liye AWB number required hai."
        });
      }

      /*
      -----------------------------------------
      Shiprocket AWB Tracking API
      -----------------------------------------
      */

      const trackResponse = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/track/awb/" +
          encodeURIComponent(String(awb)),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );

      const trackData =
        await trackResponse.json();

      if (!trackResponse.ok) {
        return res.status(400).json({
          success: false,
          error:
            trackData.message ||
            trackData.error ||
            "Tracking information nahi mili",
          raw: trackData
        });
      }

      /*
      -----------------------------------------
      Tracking data normalize
      -----------------------------------------
      */

      const trackingData =
        trackData?.tracking_data ||
        trackData?.data ||
        trackData;

      const shipmentTrack =
        trackingData?.shipment_track?.[0] ||
        trackingData?.shipment_track ||
        {};

      const shipmentTrackActivities =
        trackingData?.shipment_track_activities ||
        trackingData?.shipment_track_activities ||
        [];

      const courierName =
        shipmentTrack?.courier_name ||
        trackingData?.courier_name ||
        trackingData?.courier ||
        "";

      const currentStatus =
        shipmentTrack?.current_status ||
        shipmentTrack?.status ||
        trackingData?.current_status ||
        trackingData?.status ||
        "";

      const statusCode =
        shipmentTrack?.status_code ||
        trackingData?.status_code ||
        null;

      const etd =
        shipmentTrack?.edd ||
        shipmentTrack?.etd ||
        trackingData?.edd ||
        trackingData?.etd ||
        "";

      const deliveredDate =
        shipmentTrack?.delivered_date ||
        trackingData?.delivered_date ||
        "";

      const pickupDate =
        shipmentTrack?.pickup_date ||
        trackingData?.pickup_date ||
        "";

      const destination =
        shipmentTrack?.destination ||
        trackingData?.destination ||
        "";

      const origin =
        shipmentTrack?.origin ||
        trackingData?.origin ||
        "";

      /*
      Shiprocket tracking URL
      */

      const trackingUrl =
        trackingData?.track_url ||
        shipmentTrack?.track_url ||
        `https://www.shiprocket.in/shipment-tracking/`;

      return res.status(200).json({
        success: true,
        type: "tracking",

        awb: String(awb),

        courier_name: courierName,

        current_status: currentStatus,

        status_code: statusCode,

        estimated_delivery: etd,

        delivered_date: deliveredDate,

        pickup_date: pickupDate,

        origin: origin,

        destination: destination,

        tracking_url: trackingUrl,

        activities: Array.isArray(
          shipmentTrackActivities
        )
          ? shipmentTrackActivities
          : [],

        raw: trackData
      });
    }

    /*
    =========================================================
    UNKNOWN ACTION
    =========================================================
    */

    return res.status(400).json({
      success: false,
      error:
        "Invalid action. Use 'rate' or 'track'."
    });

  } catch (error) {
    console.error(
      "Shiprocket API Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Shiprocket server error"
    });
  }
}
