export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST method is allowed"
    });
  }

  try {
    const body = req.body || {};

    const action = body.action || "rate";

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;
    const pickupPincode =
      process.env.SHIPROCKET_PICKUP_PINCODE;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        error:
          "SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD missing in Vercel"
      });
    }

    if (!pickupPincode) {
      return res.status(500).json({
        success: false,
        error:
          "SHIPROCKET_PICKUP_PINCODE missing in Vercel"
      });
    }

    /* =====================================================
       SHIPROCKET LOGIN
    ===================================================== */

    async function getToken() {
      const response = await fetch(
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

      const data = await response.json();

      if (!response.ok || !data.token) {
        throw new Error(
          data.message ||
          "Shiprocket login failed"
        );
      }

      return data.token;
    }

    const token = await getToken();

    /* =====================================================
       1. SHIPPING RATE
       action = rate
    ===================================================== */

    if (action === "rate") {
      const {
        deliveryPincode,
        weight = 0.5,
        cod = 1,
        declaredValue = 0
      } = body;

      if (!/^[0-9]{6}$/.test(String(deliveryPincode || ""))) {
        return res.status(400).json({
          success: false,
          error: "Valid 6 digit delivery pincode required"
        });
      }

      const params = new URLSearchParams({
        pickup_postcode: String(pickupPincode),
        delivery_postcode: String(deliveryPincode),
        weight: String(weight),
        cod: String(cod),
        declared_value: String(declaredValue)
      });

      const response = await fetch(
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

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            "Shipping rate check failed"
        });
      }

      const couriers =
        data?.data?.available_courier_companies || [];

      if (!couriers.length) {
        return res.status(404).json({
          success: false,
          error:
            "Is pincode ke liye courier available nahi mila."
        });
      }

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

        courier_id:
          best.courier_company_id || null,

        estimated_delivery:
          best.etd || "",

        delivery_pincode:
          String(deliveryPincode),

        all_couriers: couriers.map(c => ({
          courier_name:
            c.courier_name || "",

          courier_id:
            c.courier_company_id || null,

          freight_charge:
            Number(c.freight_charge || 0),

          etd:
            c.etd || ""
        }))
      });
    }

    /* =====================================================
       2. CREATE SHIPROCKET ORDER
       action = create_order
    ===================================================== */

    if (action === "create_order") {
      const {
        orderId,
        customerName,
        customerPhone,
        customerEmail = "",
        address,
        city,
        state,
        pincode,
        productName,
        quantity = 1,
        price = 0,
        paymentMethod = "COD",
        weight = 0.5,
        length = 20,
        breadth = 15,
        height = 5
      } = body;

      if (!orderId) {
        return res.status(400).json({
          success: false,
          error: "Website order ID required"
        });
      }

      if (!customerName) {
        return res.status(400).json({
          success: false,
          error: "Customer name required"
        });
      }

      if (!customerPhone) {
        return res.status(400).json({
          success: false,
          error: "Customer phone required"
        });
      }

      if (!address || !city || !state || !pincode) {
        return res.status(400).json({
          success: false,
          error:
            "Complete customer address required"
        });
      }

      const orderPayload = {
        order_id: String(orderId),

        order_date:
          new Date().toISOString().slice(0, 19),

        pickup_location:
          process.env.SHIPROCKET_PICKUP_LOCATION ||
          "Primary",

        channel_id:
          process.env.SHIPROCKET_CHANNEL_ID
            ? Number(
                process.env.SHIPROCKET_CHANNEL_ID
              )
            : undefined,

        billing_customer_name:
          customerName,

        billing_last_name: "",

        billing_address:
          address,

        billing_address_2: "",

        billing_city:
          city,

        billing_pincode:
          String(pincode),

        billing_state:
          state,

        billing_country:
          "India",

        billing_email:
          customerEmail,

        billing_phone:
          customerPhone,

        shipping_is_billing:
          true,

        order_items: [
          {
            name:
              productName || "Aarvi Fashion Product",

            sku:
              "AARVI-" + String(orderId),

            units:
              Number(quantity),

            selling_price:
              Number(price),

            discount:
              0,

            tax:
              0,

            hsn:
              ""
          }
        ],

        payment_method:
          String(paymentMethod).toUpperCase() ===
          "COD"
            ? "COD"
            : "Prepaid",

        shipping_charges:
          0,

        giftwrap_charges:
          0,

        transaction_charges:
          0,

        total_discount:
          0,

        sub_total:
          Number(price) * Number(quantity),

        length:
          Number(length),

        breadth:
          Number(breadth),

        height:
          Number(height),

        weight:
          Number(weight)
      };

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          },
          body: JSON.stringify(orderPayload)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "Shiprocket order create failed",
          shiprocket_response: data
        });
      }

      return res.status(200).json({
        success: true,

        message:
          "Shiprocket order created",

        shiprocket_order_id:
          data.order_id ||
          data.orderId ||
          null,

        shipment_id:
          data.shipment_id ||
          data.shipmentId ||
          null,

        status:
          data.status ||
          "Created",

        response: data
      });
    }

    /* =====================================================
       3. GENERATE AWB
       action = generate_awb
    ===================================================== */

    if (action === "generate_awb") {
      const {
        shipmentId,
        courierId
      } = body;

      if (!shipmentId) {
        return res.status(400).json({
          success: false,
          error: "Shipment ID required"
        });
      }

      const payload = {
        shipment_id:
          Number(shipmentId)
      };

      if (courierId) {
        payload.courier_id =
          Number(courierId);
      }

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/assign/awb",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "AWB generate failed",
          response: data
        });
      }

      const shipment =
        data?.response?.data ||
        data?.data ||
        data;

      return res.status(200).json({
        success: true,

        awb_code:
          shipment?.awb_code ||
          shipment?.awb ||
          data?.awb_code ||
          "",

        courier_name:
          shipment?.courier_name ||
          data?.courier_name ||
          "",

        courier_company_id:
          shipment?.courier_company_id ||
          data?.courier_company_id ||
          null,

        shipment_id:
          Number(shipmentId),

        response:
          data
      });
    }

    /* =====================================================
       4. REQUEST PICKUP
       action = pickup
    ===================================================== */

    if (action === "pickup") {
      const {
        shipmentId,
        pickupDate
      } = body;

      if (!shipmentId) {
        return res.status(400).json({
          success: false,
          error: "Shipment ID required"
        });
      }

      const payload = {
        shipment_id: [
          Number(shipmentId)
        ]
      };

      if (pickupDate) {
        payload.pickup_date = [
          pickupDate
        ];
      }

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/generate/pickup",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "Pickup request failed",
          response: data
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Pickup request submitted",
        response:
          data
      });
    }

    /* =====================================================
       5. TRACK AWB
       action = track
    ===================================================== */

    if (action === "track") {
      const {
        awb
      } = body;

      if (!awb) {
        return res.status(400).json({
          success: false,
          error: "AWB number required"
        });
      }

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/track/awb/" +
          encodeURIComponent(String(awb)),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "Tracking failed",
          response: data
        });
      }

      return res.status(200).json({
        success: true,

        awb:
          String(awb),

        tracking:
          data,

        status:
          data?.tracking_data?.shipment_status ||
          data?.tracking_data?.shipment_status_name ||
          data?.tracking_data?.status ||
          "",

        courier_name:
          data?.tracking_data?.courier_name ||
          "",

        etd:
          data?.tracking_data?.etd ||
          "",

        current_location:
          data?.tracking_data?.current_location ||
          "",

        scans:
          data?.tracking_data?.shipment_track_activities ||
          []
      });
    }

    /* =====================================================
       6. SHIPMENT DETAILS
       action = shipment
    ===================================================== */

    if (action === "shipment") {
      const {
        shipmentId
      } = body;

      if (!shipmentId) {
        return res.status(400).json({
          success: false,
          error: "Shipment ID required"
        });
      }

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/shipments/" +
          encodeURIComponent(String(shipmentId)),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "Shipment details failed",
          response: data
        });
      }

      return res.status(200).json({
        success: true,
        shipment:
          data
      });
    }

    /* =====================================================
       7. LABEL
       action = label
    ===================================================== */

    if (action === "label") {
      const {
        shipmentId
      } = body;

      if (!shipmentId) {
        return res.status(400).json({
          success: false,
          error: "Shipment ID required"
        });
      }

      const response = await fetch(
        "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${token}`
          },
          body: JSON.stringify({
            shipment_id: [
              Number(shipmentId)
            ]
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error:
            data.message ||
            data.error ||
            "Label generation failed",
          response: data
        });
      }

      return res.status(200).json({
        success: true,
        label_url:
          data?.label_url ||
          data?.response?.label_url ||
          "",
        response:
          data
      });
    }

    /* =====================================================
       UNKNOWN ACTION
    ===================================================== */

    return res.status(400).json({
      success: false,
      error:
        "Invalid action. Use rate, create_order, generate_awb, pickup, track, shipment or label."
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
