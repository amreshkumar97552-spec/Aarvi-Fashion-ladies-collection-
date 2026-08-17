export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Only POST method is allowed"
    });
  }

  try {
    const body = req.body || {};

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;
    const pickupPincode =
      process.env.SHIPROCKET_PICKUP_PINCODE;
    const pickupLocation =
      process.env.SHIPROCKET_PICKUP_LOCATION;

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        error: "SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD missing in Vercel"
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

    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    };

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
      const deliveryPincode =
        body.deliveryPincode ||
        body.delivery_pincode ||
        body.pincode ||
        body.pin_code;

      const weight =
        Number(body.weight || 0.5);

      const cod =
        Number(
          body.cod ??
          (
            String(body.paymentMethod || body.payment_method || "COD")
              .toUpperCase() === "COD"
              ? 1
              : 0
          )
        );

      const declaredValue =
        Number(
          body.declaredValue ||
          body.declared_value ||
          body.amount ||
          0
        );

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
        declared_value: String(declaredValue)
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
            "Shipping rate check failed",
          raw: rateData
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
          Number(
            best.rate ||
            best.freight_charge ||
            0
          )
      });
    }

    /*
    =========================================================
    2. CREATE ORDER IN SHIPROCKET
    =========================================================
    */

    if (
      action === "create" ||
      action === "create_order" ||
      action === "order" ||
      action === "ship"
    ) {
      if (!pickupLocation) {
        return res.status(500).json({
          success: false,
          error:
            "SHIPROCKET_PICKUP_LOCATION missing in Vercel"
        });
      }

      if (!pickupPincode) {
        return res.status(500).json({
          success: false,
          error:
            "SHIPROCKET_PICKUP_PINCODE missing in Vercel"
        });
      }

      /*
      ---------------------------------------------------------
      Customer details
      ---------------------------------------------------------
      */

      const customerName =
        body.customerName ||
        body.customer_name ||
        body.name ||
        "";

      const phone =
        body.phone ||
        body.customerPhone ||
        body.customer_phone ||
        "";

      const address =
        body.address ||
        body.customerAddress ||
        body.customer_address ||
        "";

      const city =
        body.city ||
        "";

      const state =
        body.state ||
        "";

      const pincode =
        body.deliveryPincode ||
        body.delivery_pincode ||
        body.pin_code ||
        body.pincode ||
        "";

      const customerEmail =
        body.email ||
        body.customerEmail ||
        body.customer_email ||
        "";

      if (!customerName) {
        return res.status(400).json({
          success: false,
          error: "Customer name required"
        });
      }

      if (!phone) {
        return res.status(400).json({
          success: false,
          error: "Customer phone required"
        });
      }

      if (!address) {
        return res.status(400).json({
          success: false,
          error: "Customer address required"
        });
      }

      if (!city || !state || !pincode) {
        return res.status(400).json({
          success: false,
          error:
            "Customer city, state and pincode required"
        });
      }

      /*
      ---------------------------------------------------------
      Product details
      ---------------------------------------------------------
      */

      const productName =
        body.productName ||
        body.product_name ||
        body.name_of_product ||
        "Aarvi Fashion Product";

      const productId =
        body.productId ||
        body.product_id ||
        body.sku ||
        `AF-${Date.now()}`;

      const sku =
        body.sku ||
        String(productId);

      const quantity =
        Math.max(
          1,
          Number(
            body.quantity ||
            body.qty ||
            1
          )
        );

      const unitPrice =
        Number(
          body.unitPrice ||
          body.unit_price ||
          body.price ||
          0
        );

      const shippingCharges =
        Math.max(
          0,
          Number(
            body.shippingAmount ||
            body.shipping_amount ||
            body.shippingCharges ||
            body.shipping_charges ||
            0
          )
        );

      const discount =
        Number(
          body.discount ||
          0
        );

      const subTotal =
        Math.max(
          0,
          (unitPrice * quantity) - discount
        );

      const totalAmount =
        subTotal + shippingCharges;

      /*
      ---------------------------------------------------------
      Payment method
      ---------------------------------------------------------
      */

      const paymentMethod =
        String(
          body.paymentMethod ||
          body.payment_method ||
          "COD"
        ).toUpperCase();

      const shiprocketPaymentMethod =
        paymentMethod === "COD"
          ? "COD"
          : "Prepaid";

      /*
      ---------------------------------------------------------
      Weight / dimensions
      ---------------------------------------------------------
      */

      const weight =
        Math.max(
          0.01,
          Number(body.weight || 0.5)
        );

      const length =
        Math.max(
          0.6,
          Number(body.length || 20)
        );

      const breadth =
        Math.max(
          0.6,
          Number(body.breadth || 15)
        );

      const height =
        Math.max(
          0.6,
          Number(body.height || 5)
        );

      /*
      ---------------------------------------------------------
      Unique website order ID
      ---------------------------------------------------------
      */

      const websiteOrderId =
        body.orderId ||
        body.order_id ||
        body.orderNumber ||
        `AF-${Date.now()}`;

      /*
      ---------------------------------------------------------
      Shiprocket Create Order Payload
      ---------------------------------------------------------
      */

      const createPayload = {
        order_id: String(websiteOrderId),

        order_date:
          body.orderDate ||
          body.order_date ||
          new Date().toISOString(),

        pickup_location:
          String(pickupLocation),

        comment:
          "Aarvi Fashion Online Order",

        billing_customer_name:
          String(customerName),

        billing_last_name:
          "",

        billing_address:
          String(address),

        billing_address_2:
          "",

        billing_city:
          String(city),

        billing_pincode:
          String(pincode),

        billing_state:
          String(state),

        billing_country:
          "India",

        billing_email:
          String(
            customerEmail ||
            "customer@aarvifashion.in"
          ),

        billing_phone:
          String(phone),

        shipping_is_billing:
          true,

        shipping_customer_name:
          String(customerName),

        shipping_last_name:
          "",

        shipping_address:
          String(address),

        shipping_address_2:
          "",

        shipping_city:
          String(city),

        shipping_pincode:
          String(pincode),

        shipping_country:
          "India",

        shipping_state:
          String(state),

        shipping_email:
          String(
            customerEmail ||
            "customer@aarvifashion.in"
          ),

        shipping_phone:
          String(phone),

        order_items: [
          {
            name:
              String(productName),

            sku:
              String(sku),

            units:
              quantity,

            selling_price:
              unitPrice,

            discount:
              discount,

            tax:
              0,

            hsn:
              body.hsn ||
              ""
          }
        ],

        payment_method:
          shiprocketPaymentMethod,

        shipping_charges:
          shippingCharges,

        giftwrap_charges:
          0,

        transaction_charges:
          0,

        total_discount:
          discount,

        sub_total:
          subTotal,

        length:
          length,

        breadth:
          breadth,

        height:
          height,

        weight:
          weight
      };

      /*
      ---------------------------------------------------------
      CREATE ORDER
      ---------------------------------------------------------
      */

      const createResponse = await fetch(
        "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(createPayload)
        }
      );

      const createData =
        await createResponse.json();

      if (!createResponse.ok) {
        return res.status(400).json({
          success: false,
          type: "create_order",
          error:
            createData.message ||
            createData.error ||
            "Shiprocket order create failed",
          raw: createData
        });
      }

      const shiprocketOrderId =
        createData?.order_id ||
        createData?.data?.order_id ||
        createData?.id ||
        null;

      const shipmentId =
        createData?.shipment_id ||
        createData?.data?.shipment_id ||
        null;

      /*
      ---------------------------------------------------------
      If Shiprocket created order but shipment ID unavailable
      ---------------------------------------------------------
      */

      if (!shipmentId) {
        return res.status(200).json({
          success: true,
          type: "shiprocket_order_created",

          message:
            "Shiprocket me order create ho gaya, lekin shipment ID response me nahi mili.",

          shiprocket_order_id:
            shiprocketOrderId,

          shipment_id:
            null,

          awb:
            null,

          courier_name:
            "",

          raw:
            createData
        });
      }

      /*
      ---------------------------------------------------------
      COURIER SERVICEABILITY
      Select cheapest courier
      ---------------------------------------------------------
      */

      let courierId =
        body.courierId ||
        body.courier_id ||
        null;

      let courierName =
        "";

      if (!courierId) {
        const rateParams =
          new URLSearchParams({
            pickup_postcode:
              String(pickupPincode),

            delivery_postcode:
              String(pincode),

            weight:
              String(weight),

            cod:
              shiprocketPaymentMethod === "COD"
                ? "1"
                : "0",

            declared_value:
              String(totalAmount)
          });

        const rateResponse =
          await fetch(
            "https://apiv2.shiprocket.in/v1/external/courier/serviceability?" +
              rateParams.toString(),
            {
              method: "GET",
              headers: authHeaders
            }
          );

        const rateData =
          await rateResponse.json();

        const couriers =
          rateData?.data?.available_courier_companies ||
          [];

        if (couriers.length) {
          const sorted =
            [...couriers].sort(
              (a, b) =>
                Number(a.freight_charge || 0) -
                Number(b.freight_charge || 0)
            );

          courierId =
            sorted[0]?.courier_company_id ||
            null;

          courierName =
            sorted[0]?.courier_name ||
            "";
        }
      }

      /*
      ---------------------------------------------------------
      ASSIGN AWB
      ---------------------------------------------------------
      */

      let awb = null;
      let awbError = null;

      if (courierId) {
        const awbResponse =
          await fetch(
            "https://apiv2.shiprocket.in/v1/external/courier/assign/awb",
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                shipment_id:
                  Number(shipmentId),

                courier_id:
                  Number(courierId)
              })
            }
          );

        const awbData =
          await awbResponse.json();

        if (awbResponse.ok) {
          awb =
            awbData?.response?.data?.awb_code ||
            awbData?.response?.data?.awb ||
            awbData?.awb_code ||
            awbData?.awb ||
            null;

          courierName =
            awbData?.response?.data?.courier_name ||
            awbData?.courier_name ||
            courierName;
        } else {
          awbError =
            awbData?.message ||
            awbData?.error ||
            "AWB assignment failed";
        }
      } else {
        awbError =
          "Is delivery pincode ke liye courier nahi mila.";
      }

      /*
      ---------------------------------------------------------
      GENERATE PICKUP REQUEST
      ---------------------------------------------------------
      */

      let pickupRequested = false;
      let pickupError = null;

      if (awb) {
        const pickupResponse =
          await fetch(
            "https://apiv2.shiprocket.in/v1/external/courier/generate/pickup",
            {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                shipment_id: [
                  Number(shipmentId)
                ]
              })
            }
          );

        const pickupData =
          await pickupResponse.json();

        if (pickupResponse.ok) {
          pickupRequested = true;
        } else {
          pickupError =
            pickupData?.message ||
            pickupData?.error ||
            "Pickup request failed";
        }
      }

      /*
      ---------------------------------------------------------
      FINAL RESPONSE
      ---------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        type:
          "shiprocket_order_created",

        message:
          "Order Shiprocket me successfully create ho gaya.",

        website_order_id:
          String(websiteOrderId),

        shiprocket_order_id:
          shiprocketOrderId,

        shipment_id:
          shipmentId,

        awb:
          awb,

        courier_id:
          courierId,

        courier_name:
          courierName,

        pickup_requested:
          pickupRequested,

        tracking_url:
          awb
            ? `https://www.shiprocket.in/shipment-tracking/${encodeURIComponent(
                String(awb)
              )}`
            : "",

        awb_error:
          awbError,

        pickup_error:
          pickupError,

        shipping_charge:
          shippingCharges,

        total_amount:
          totalAmount,

        raw:
          createData
      });
    }

    /*
    =========================================================
    3. TRACKING
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

      if (!awb && shipmentId) {
        const shipmentResponse =
          await fetch(
            "https://apiv2.shiprocket.in/v1/external/shipments/" +
              encodeURIComponent(
                String(shipmentId)
              ),
            {
              method: "GET",
              headers: authHeaders
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
              "Shipment details nahi mile",
            raw:
              shipmentData
          });
        }

        awb =
          shipmentData?.data?.awb ||
          shipmentData?.data?.awb_code ||
          shipmentData?.data?.shipment?.awb ||
          shipmentData?.data?.shipment?.awb_code ||
          shipmentData?.awb ||
          shipmentData?.awb_code ||
          "";
      }

      if (!awb) {
        return res.status(400).json({
          success: false,
          error:
            "Tracking ke liye AWB number required hai."
        });
      }

      const trackResponse =
        await fetch(
          "https://apiv2.shiprocket.in/v1/external/courier/track/awb/" +
            encodeURIComponent(
              String(awb)
            ),
          {
            method: "GET",
            headers: authHeaders
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
          raw:
            trackData
        });
      }

      const trackingData =
        trackData?.tracking_data ||
        trackData?.data ||
        trackData;

      const shipmentTrack =
        trackingData?.shipment_track?.[0] ||
        trackingData?.shipment_track ||
        {};

      const activities =
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

      const trackingUrl =
        trackingData?.track_url ||
        shipmentTrack?.track_url ||
        `https://www.shiprocket.in/shipment-tracking/${encodeURIComponent(
          String(awb)
        )}`;

      return res.status(200).json({
        success: true,
        type: "tracking",

        awb:
          String(awb),

        courier_name:
          courierName,

        current_status:
          currentStatus,

        status_code:
          statusCode,

        estimated_delivery:
          etd,

        delivered_date:
          deliveredDate,

        pickup_date:
          pickupDate,

        origin:
          origin,

        destination:
          destination,

        tracking_url:
          trackingUrl,

        activities:
          Array.isArray(activities)
            ? activities
            : [],

        raw:
          trackData
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
        "Invalid action. Use rate, create_order or track."
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
