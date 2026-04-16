import { z } from 'zod';

// Inlined from utils/currencies.ts
const currencyOptions = [
  '$', '€', '£', 'GBP', 'AUD', 'CAD', 'CHF', 'ZAR', 'CNY', 'SEK', 'NZD', 'MXN',
  'SGD', 'HKD', 'NOK', 'KRW', 'TRY', 'RUB', 'INR', 'BRL', 'DKK', 'PLN', 'TWD',
  'THB', 'IDR', 'HUF', 'CZK', 'ILS', 'CLP', 'PHP', 'AED', 'COP', 'SAR', 'MYR',
  'RON', 'ARS', 'BGN', 'ISK', 'EGP',
] as const;

// Inlined from utils/timeCalculationConstants.ts
const defaultOpenHours = [
  { day: 0, times: [{ start: '08:00', end: '18:00' }] },
  { day: 1, times: [{ start: '08:00', end: '18:00' }] },
  { day: 2, times: [{ start: '08:00', end: '18:00' }] },
  { day: 3, times: [{ start: '08:00', end: '18:00' }] },
  { day: 4, times: [{ start: '08:00', end: '18:00' }] },
  { day: 5, times: [{ start: '08:00', end: '18:00' }] },
  { day: 6, times: [{ start: '08:00', end: '18:00' }] },
];

// Reusable schema for marketing text sections
export const textSectionSchema = z.object({
  heading: z.string().max(80).describe('Main heading, e.g., "About Us". 1–80 chars.'),
  subline: z.string().max(120).describe('Supporting subline. 1–120 chars.'),
  content: z.string().max(10000).describe('Body text describing the section. Supports long-form content.'),
  colors_inverted: z.boolean().describe('True for dark background with light text, false for standard.'),
  image: z.string().nullable().describe('Stock photo keywords, e.g., "team working". Null for no image.'),
  imageLayout: z
    .enum(['hero', 'left', 'right', 'none'])
    .describe('"hero" (full-width top), "left", "right", or "none" (text only).'),
});

export type TextSection = z.infer<typeof textSectionSchema>;

export const textSectionsSchema = z
  .object({
    beforeServices: z
      .array(textSectionSchema)
      .default([])
      .describe('Sections displayed BEFORE services. Use for "About Us" or value propositions.'),
    beforeResources: z
      .array(textSectionSchema)
      .default([])
      .describe('Sections displayed BETWEEN services and resources. Use for "Meet the Team" or facility showcases.'),
    beforeFooter: z
      .array(textSectionSchema)
      .default([])
      .describe('Sections displayed AFTER resources. Use for contact info, testimonials, or call-to-action.'),
  })
  .default({ beforeServices: [], beforeResources: [], beforeFooter: [] })
  .describe('Optional marketing text sections with heading, subline, content, colors_inverted, image, imageLayout.');

export type TextSections = z.infer<typeof textSectionsSchema>;

export const bookingPageToolParameters = z.object({
  bookingPage: z.object({
    page_title: z
      .string()
      .max(30)
      .describe(
        'The title of the Booking Page, displayed to clients, e.g., "Sunny Yoga Bookings". Must be 1–30 characters, concise, and reflect the business name or purpose.',
      ),
    tagLine: z
      .string()
      .max(50)
      .describe(
        'A short, engaging slogan for the Booking Page, e.g., "Book Your Zen Today!". Must be 1–50 characters, client-facing, and aligned with the business brand.',
      ),
    backgroundImage: z
      .string()
      .describe(
        'Stock photo search keywords for the banner image, e.g., "yoga studio interior", "modern barbershop", "spa wellness center". Use 2-5 simple, searchable keywords that describe the business setting. Leave empty if no image is needed, defaulting to a plain background.',
      ),
    letterBg: z
      .string()
      .describe(
        'The background color for text elements in hex format, e.g., "#FFFFFF" for white. Must ensure readability against the text color.',
      ),
    color: z
      .string()
      .describe(
        'The text color for the Booking Page in hex format, e.g., "#000000" for black. Must contrast with the background for legibility.',
      ),
    bgColor: z
      .string()
      .describe(
        'The overall background color of the Booking Page in hex format, e.g., "#F5F5F5" for light gray. Must align with the business's branding.',
      ),
    organization_name: z
      .string()
      .describe(
        'The business name, e.g., "Sunny Yoga Studio". Before official name is known: use descriptive placeholder, once official name is known: always use official brand name.',
      ),
    page_title_header: z
      .boolean()
      .describe(
        'Set to true to display the page title in the Booking Page header, enhancing visibility, or false to hide it. Defaults to true unless specified.',
      ),
    start_event_string: z
      .string()
      .max(50)
      .describe(
        'Client-facing text shown when selecting an event, e.g., "Choose Your Class". Must be 1–50 characters, clear, and action-oriented.',
      ),
    start_service_string: z
      .string()
      .max(50)
      .describe(
        'Client-facing text shown when selecting a service, e.g., "Pick a Service". Must be 1–50 characters, intuitive, and relevant to the booking flow.',
      ),
    start_resource_string: z
      .string()
      .max(50)
      .describe(
        'Client-facing text shown when selecting a resource, e.g., "Select a Stylist". Must be 1–50 characters, specific to the resource type (e.g., staff or room).',
      ),
    frontpage_show_event_image: z
      .boolean()
      .describe(
        'Set to true to display event images or icons on the Booking Page's front page, enhancing visual appeal. Always true to ensure a client-friendly experience.',
      ),
    frontpage_show_service_image: z
      .boolean()
      .describe(
        'Set to true to display service images or icons on the Booking Page's front page, improving clarity. Always true for a consistent client interface.',
      ),
    frontpage_show_resource_image: z
      .boolean()
      .describe(
        'Set to true to display resource images or icons on the Booking Page's front page, aiding client selection. Always true for visual consistency.',
      ),
    event_squared: z
      .boolean()
      .describe(
        'Set to true for a horizontal event layout or false for a vertical layout on the Booking Page. Defaults to false (vertical) unless explicitly requested via chat or dashboard.',
      ),
    service_squared: z
      .boolean()
      .describe(
        'Set to true for a horizontal service layout or false for a vertical layout on the Booking Page. Defaults to false (vertical) unless explicitly requested via chat or dashboard.',
      ),
    resource_squared: z
      .boolean()
      .describe(
        'Set to true for a horizontal resource layout or false for a vertical layout on the Booking Page. Defaults to true (horizontal) unless explicitly changed via chat or dashboard.',
      ),
    second_show_resource_image: z
      .boolean()
      .describe(
        'Set to true to show resource images or icons on the second page of the booking flow, e.g., during time slot selection. Defaults to true unless specified.',
      ),
    second_show_service_image: z
      .boolean()
      .describe(
        'Set to true to show service images or icons on the second page of the booking flow, e.g., when selecting a resource. Defaults to true unless specified.',
      ),
    disable_cart: z
      .boolean()
      .describe(
        'Set to true to disable the multi-booking cart, restricting clients to single bookings per checkout, or false to allow multiple bookings. Defaults to false.',
      ),
    second_resource_pick: z
      .string()
      .max(50)
      .describe(
        'The default resource displayed on the second page of the booking page, e.g., "Barber Joe". Must be 1–50 characters and match an existing resource name.',
      ),
    second_service_pick: z
      .string()
      .max(50)
      .describe(
        'The default service displayed on the second page of the booking page, e.g., "30-Minute Haircut". Must be 1–50 characters and match an existing service name.',
      ),
    second_show_event_image: z
      .boolean()
      .describe(
        'Set to true to show event images or icons on the second page of the booking page, e.g., during event details. Defaults to true unless specified.',
      ),
    tickets_name: z
      .string()
      .max(30)
      .describe(
        'The name for event tickets, e.g., "Class Passes". Must be 1–30 characters, clear, and client-facing.',
      ),
    tickets_description: z
      .string()
      .max(60)
      .describe(
        'A concise description of event tickets, e.g., "Join our yoga classes!". Must be 1–60 characters, engaging, and relevant.',
      ),
    textSections: z
      .object({
        beforeServices: z
          .array(textSectionSchema)
          .default([])
          .describe('Sections displayed BEFORE services. Use for "About Us" or value propositions.'),
        beforeResources: z
          .array(textSectionSchema)
          .default([])
          .describe(
            'Sections displayed BETWEEN services and resources. Use for "Meet the Team" or facility showcases.',
          ),
        beforeFooter: z
          .array(textSectionSchema)
          .default([])
          .describe(
            'Sections displayed AFTER resources. Use for contact info, testimonials, or call-to-action.',
          ),
      })
      .default({ beforeServices: [], beforeResources: [], beforeFooter: [] })
      .describe(
        'Optional marketing text sections (About Us, team intros, contact info). Each position can have multiple sections with heading, subline, content, colors_inverted, image, and imageLayout.',
      ),
  }),
  services: z
    .array(
      z.object({
        id: z
          .number()
          .describe(
            'A unique numeric ID for the service, automatically generated by Oskar to identify the service in the system.',
          ),
        name: z
          .string()
          .max(30)
          .describe(
            'The client-facing name of the service, e.g., "30-Minute Haircut". Must be 1–30 characters, descriptive, and specific to the offering.',
          ),
        image: z
          .string()
          .nullable()
          .describe(
            'Stock photo search keywords for the service, e.g., "haircut salon", "massage therapy spa", "personal training gym". Use 2-4 simple keywords describing the service activity. Set to null to use the icon instead, unless the user explicitly requests an image via chat.',
          ),
        icon: z
          .string()
          .nullable()
          .describe(
            'The icon for the service, e.g., "scissors" for a haircut. Must be a valid icon identifier supported by Oskar. Set to null if an image is provided or no visual is needed.',
          ),
        show_on_bookingpage: z
          .boolean()
          .describe(
            'Set to true to display the service on the Booking Page for service-first flows (e.g., clients select "Haircut" before "Barber Joe") or false for resource-first flows (e.g., select "Barber Joe" first). Override to true if explicitly requested via chat or dashboard. Defaults based on booking flow.',
          ),
        admin_only: z
          .boolean()
          .describe(
            'Set to true to restrict the service visibility to admins only, e.g., for internal testing or exclusive offerings. Defaults to false for client access.',
          ),
        hide_duration: z
          .boolean()
          .describe(
            'Set to true to hide the service duration from clients on the Booking Page, simplifying the UI, or false to display it. Defaults to false.',
          ),
        service_extra: z
          .array(
            z.object({
              extra: z.object({
                extra_version: z.object({
                  id: z
                    .string()
                    .describe(
                      'A unique string ID for the extra version, automatically generated by Oskar to track add-ons.',
                    ),
                  name: z
                    .string()
                    .max(30)
                    .describe(
                      'The client-facing name of the add-on, e.g., "Deep Conditioning". Must be 1–30 characters, clear, and relevant.',
                    ),
                  description: z
                    .string()
                    .max(80)
                    .describe(
                      'A brief client-facing description of the add-on, e.g., "Nourish your hair with premium products". Must be 1–80 characters, shown in booking lists.',
                    ),
                  price: z
                    .number()
                    .describe(
                      'The additional price for the add-on, e.g., 10 for $10. Must be a non-negative number.',
                    ),
                  tax: z
                    .number()
                    .describe(
                      'The tax percentage for the add-on, e.g., 8 for 8%. Must be a non-negative number.',
                    ),
                  repeat: z
                    .boolean()
                    .describe(
                      'Set to true if the add-on cost repeats per duration unit, e.g., per night for a hotel breakfast. Set to false for a one-time charge. Defaults to false.',
                    ),
                }),
              }),
            }),
          )
          .describe(
            'Add-ons (extras) for the service, e.g., "Extended Massage" for $10. Include only if explicitly requested via chat or dashboard. Must not extend the service duration. Supports pricing and tax calculations in checkout.',
          ),
        resource_service: z
          .array(
            z.object({
              resources: z.object({
                id: z
                  .number()
                  .describe(
                    'The unique numeric ID of the resource linked to the service, e.g., 1 for "Barber Joe". Must match an existing resource ID.',
                  ),
              }),
            }),
          )
          .describe(
            'The resources assigned to the service, e.g., "Barber Joe" for a haircut, to ensure scheduling accuracy. Must include at least one resource if the service is active.',
          ),
        listOrder: z
          .number()
          .describe(
            'The numeric order for displaying the service on the Booking Page, e.g., 1 to appear first. Must be a non-negative integer.',
          ),
        description: z
          .string()
          .max(120)
          .describe(
            'A brief client-facing description of the service, e.g., "Quick haircut with precision". Must be 1–120 characters, engaging, and informative.',
          ),
        moreInformation: z
          .string()
          .max(400)
          .describe(
            'Additional client-facing details about the service, e.g., "Perfect for a fresh, modern look". Must be 1–400 characters, optional, and complementary to the description.',
          ),
        service_groups: z
          .array(
            z.object({
              groups: z.object({
                id: z
                  .number()
                  .describe('A unique numeric ID for the service group, automatically generated by Oskar.'),
                name: z
                  .string()
                  .max(30)
                  .describe(
                    'The client-facing name of the service group, e.g., "Haircuts" or "Nails". Must be 1–30 characters, descriptive, and distinct. ',
                  ),
              }),
            }),
          )
          .describe(
            'Groups to organize services, e.g., "Haircuts" for multiple haircut types. Include only if services vary significantly. Use short, clear names, set via chat or dashboard.',
          ),
        price: z
          .number()
          .describe(
            'The service price, e.g., 25 for $25. Set to 0 for free bookings. Must be a non-negative number. Planned feature: support for deposits.',
          ),
        duration: z
          .number()
          .describe(
            'The service duration in the specified time slot range, e.g., 30 for 30 minutes. Must be a positive integer matching the `timeSlotsRange`.',
          ),
        timeSlotsRange: z
          .enum(['month', 'week', 'min', 'day', 'night', 'quarter', 'hour', 'year'])
          .describe(
            'The unit of time for the service duration, e.g., "min" for minutes, "night" for overnight bookings, or "day" for daily rentals. Must match the duration and booking context.',
          ),
        flexTimeslots: z
          .boolean()
          .describe(
            'Set to true to allow clients to select flexible time slots, e.g., 1–3 hours for a room rental, within `minDuration` and `maxDuration`. Set to false for fixed durations. Defaults to false.',
          ),
        minDuration: z
          .number()
          .describe(
            'The minimum duration for the service in the specified `timeSlotsRange`, e.g., 30 for 30 minutes. Must be a positive integer, less than or equal to `maxDuration`.',
          ),
        maxDuration: z
          .number()
          .describe(
            'The maximum duration for the service in the specified `timeSlotsRange`, e.g., 60 for 60 minutes. Must be a positive integer, greater than or equal to `minDuration`.',
          ),
      }),
    )
    .describe('The services that are available for booking. Maximum 3 services.'),
  resources: z
    .array(
      z.object({
        id: z
          .number()
          .describe(
            'A unique numeric ID for the resource, automatically generated by Oskar to identify the resource in the system.',
          ),
        name: z
          .string()
          .max(30)
          .describe(
            'The client-facing name of the resource, e.g., "Barber Joe" or "Conference Room A". Must be 1–30 characters, specific, and clear.',
          ),
        imageSrc: z
          .string()
          .nullable()
          .describe(
            'Stock photo search keywords for the resource, e.g., "barber professional male", "yoga instructor female", "meeting room modern". Use 2-4 keywords including profession/object type. For people, include gender if relevant. Set to null to use the icon instead.',
          ),
        icon: z
          .string()
          .nullable()
          .describe(
            'The icon for the resource, e.g., "person" for staff or "chair" for rooms. Must be a valid icon identifier supported by Oskar. Set to null if an image is provided or no visual is needed.',
          ),
        show_on_bookingpage: z
          .boolean()
          .describe(
            'Set to true to display the resource on the Booking Page for resource-first flows (e.g., clients select "Barber Joe" before "Haircut") or false for service-first flows. Override to true if explicitly requested via chat or dashboard. Defaults based on booking flow.',
          ),
        admin_only: z
          .boolean()
          .describe(
            'Set to true to restrict resource visibility to admins only, e.g., for internal scheduling or testing. Defaults to false for client access.',
          ),
        listOrder: z
          .number()
          .describe(
            'The numeric order for displaying the resource on the Booking Page, e.g., 1 to appear first. Must be a non-negative integer.',
          ),
        description: z
          .string()
          .max(120)
          .describe(
            'A brief client-facing description of the resource, e.g., "Expert in fades". Must be 1–120 characters, engaging, and informative.',
          ),
        moreInformation: z
          .string()
          .max(400)
          .describe(
            'Additional client-facing details about the resource, e.g., "10 years of barbering experience". Must be 1–400 characters, optional, and complementary to the description.',
          ),
        resources_groups: z
          .array(
            z.object({
              groups: z.object({
                id: z
                  .number()
                  .describe('A unique numeric ID for the resource group, automatically generated by Oskar.'),
                name: z
                  .string()
                  .max(30)
                  .describe(
                    'The client-facing name of the resource group, e.g., "Instructors" or "Standard Rooms". Must be 1–30 characters, descriptive, and distinct. Only use groups if clearly distinct resource categories exist',
                  ),
              }),
            }),
          )
          .describe(
            'Groups to organize resources, e.g., "Standard Rooms" for multiple rooms. Include only if resources vary significantly. Use short, clear names, set via chat or dashboard.',
          ),
        category_id: z
          .number()
          .nullable()
          .describe('The unique numeric ID of the category for this resource, or null if uncategorized.')
          .default(null),
        category: z
          .object({
            id: z.number().describe('The unique numeric ID of the category.'),
            name: z.string().max(50).describe('The name of the category.'),
          })
          .nullable()
          .describe('The category object for this resource, or null if uncategorized.')
          .default(null),
        staff_member: z
          .boolean()
          .describe(
            'Set to true if the resource is a staff member (e.g., "Barber Joe") or false if an object (e.g., "Room A"). Determines scheduling and display logic.',
          ),
        multipleBookable: z
          .boolean()
          .describe(
            'Set to true if multiple clients can book the resource simultaneously, e.g., for a class or shared space. Set to false for exclusive bookings. Defaults to false.',
          ),
        multipleBookings: z
          .number()
          .describe(
            'The maximum number of simultaneous bookings for the resource, e.g., 5 for a room with 5 units. Must be a positive integer if `multipleBookable` is true; otherwise, set to 1.',
          ),
        available: z
          .array(
            z.object({
              day: z.number().int().min(0).max(6).describe('Day of the week (0 = Sunday, 6 = Saturday).'),
              times: z
                .array(
                  z.object({
                    start: z
                      .string()
                      .regex(/^\d{2}:\d{2}$/)
                      .describe('Start time in HH:MM (24h) format, e.g., "09:00".'),
                    end: z
                      .string()
                      .regex(/^\d{2}:\d{2}$/)
                      .describe('End time in HH:MM (24h) format, e.g., "17:30". Must be after start.'),
                  }),
                )
                .min(1)
                .describe('Time ranges (start/end) when this resource can be booked for the specified day.'),
            }),
          )
          .min(1)
          .describe(
            'Weekly availability for the resource. Include each day it operates with at least one start/end range. Use HH:MM 24h format. Defaults to daily 08:00–18:00.',
          )
          .default(defaultOpenHours),
        use_subresources: z
          .boolean()
          .describe(
            'Set to true when the resource tracks fungible capacity via subresources. Automatically enabled when `subresources` is not empty.',
          )
          .default(false),
        allow_subresource_selection: z
          .boolean()
          .describe(
            'Set to true to let clients pick a specific subresource during checkout (e.g., choose a desk). Automatically enabled when `subresources` is not empty.',
          )
          .default(false),
        subresources: z
          .array(
            z.object({
              name: z
                .string()
                .max(30)
                .describe(
                  'The name of an individual unit when tracking fungible capacity, e.g., "Bike 1". Must be unique per resource and 1–30 characters.',
                ),
            }),
          )
          .max(100)
          .describe(
            'List each fungible slot (boards, bikes, rooms, beds, etc.) instead of cloning resources. Leave empty for single-instance resources.',
          )
          .default([]),
      }),
    )
    .describe('The resources that are available for booking. These can also be staff. Maximum 3 resources.'),
  series: z
    .array(
      z.object({
        id: z
          .number()
          .describe(
            'A unique numeric ID for the event series, automatically generated by Oskar to identify the series in the system.',
          ),
        name: z
          .string()
          .max(30)
          .describe(
            'The client-facing name of the event series, e.g., "Yoga Flow". Must be 1–30 characters, descriptive, and specific.',
          ),
        image: z
          .string()
          .describe(
            'Stock photo search keywords for the event series, e.g., "yoga class group", "cooking workshop", "art class studio". Use 2-4 keywords describing the event type and setting. Leave empty to use the icon unless explicitly requested via chat.',
          ),
        icon: z
          .string()
          .describe(
            'The icon for the series, e.g., "yoga-pose" for yoga classes. Must be a valid icon identifier supported by Oskar. Used if no image is provided.',
          ),
        show_on_bookingpage: z
          .boolean()
          .describe(
            'Set to true to display the series on the Booking Page for client booking, or false to hide it. Defaults to true unless specified.',
          ),
        admin_only: z
          .boolean()
          .describe(
            'Set to true to restrict series visibility to admins only, e.g., for internal events or testing. Defaults to false for client access.',
          ),
        listOrder: z
          .number()
          .describe(
            'The numeric order for displaying the series on the Booking Page, e.g., 1 to appear first. Must be a non-negative integer.',
          ),
        events: z.array(
          z.object({
            id: z.number().describe('A unique numeric ID for the event, automatically generated by Oskar.'),
            start: z
              .string()
              .describe(
                'The event start time as an ISO 8601 string, e.g., "2025-09-20T18:00:00Z". Must use full hours (e.g., 18:00) unless explicitly requested otherwise. Supports multi-day events. Must be in the future.',
              ),
            end: z
              .string()
              .describe(
                'The event end time as an ISO 8601 string, e.g., "2025-09-20T19:00:00Z". Must use full hours (e.g., 19:00) unless explicitly requested otherwise. Must be after `start` and support multi-day events. Must be in the future.',
              ),
          }),
        ),
        description: z
          .string()
          .max(500)
          .describe(
            'A detailed client-facing description of the series, e.g., "Weekly yoga classes for all levels". Must be 1–500 characters, engaging, and informative.',
          ),
        price: z
          .number()
          .describe(
            'The price per event in the series, e.g., 15 for $15. Set to 0 for free events. Must be a non-negative number. Planned feature: support for tiered pricing.',
          ),
        series_id: z
          .string()
          .describe(
            'A unique string ID for the series, automatically generated by Oskar to track the series.',
          ),
        slots: z
          .number()
          .describe(
            'The number of available slots per event, e.g., 20 for a yoga class. Must be a positive integer. Defaults to 10 unless specified.',
          ),
        resources: z
          .object({
            id: z
              .number()
              .describe(
                'The unique numeric ID of the resource linked to the series, e.g., 1 for an instructor. Must match an existing resource ID.',
              ),
          })
          .describe(
            'The resource assigned to the series, e.g., an instructor for a yoga class, to ensure scheduling accuracy.',
          ),
        series_extra: z
          .array(
            z.object({
              extra: z.object({
                extra_version: z.object({
                  id: z
                    .string()
                    .describe(
                      'A unique string ID for the extra version, automatically generated by Oskar to track add-ons.',
                    ),
                  name: z
                    .string()
                    .max(30)
                    .describe(
                      'The client-facing name of the add-on, e.g., "Yoga Mat Rental". Must be 1–30 characters, clear, and relevant.',
                    ),
                  description: z
                    .string()
                    .max(80)
                    .describe(
                      'A brief client-facing description of the add-on, e.g., "Premium yoga mat for your session". Must be 1–80 characters, shown in booking lists.',
                    ),
                  price: z
                    .number()
                    .describe(
                      'The additional price for the add-on, e.g., 5 for $5. Must be a non-negative number.',
                    ),
                  tax: z
                    .number()
                    .describe(
                      'The tax percentage for the add-on, e.g., 8 for 8%. Must be a non-negative number.',
                    ),
                  repeat: z
                    .boolean()
                    .describe(
                      'Set to true if the add-on cost repeats per duration unit, e.g., per session. Set to false for a one-time charge. Defaults to false.',
                    ),
                }),
              }),
            }),
          )
          .default([])
          .describe(
            'Add-ons (extras) for the event series, e.g., "Mat Rental" for $5. Include only if explicitly requested via chat or dashboard. Must not extend the event duration. Supports pricing and tax calculations in checkout.',
          ),
      }),
    )
    .describe('The event series that are available for booking. Maximum 2 event series.'),
  currency: z
    .enum(currencyOptions as [string, ...string[]])
    .default('$')
    .describe(
      'The currency symbol or code for the organization, e.g., "$" for US Dollar, "€" for Euro, or "GBP" for British Pound. This sets the default currency for all pricing on the booking page. Defaults to "$" if not specified.',
    ),
  basic_tax: z
    .number()
    .min(0)
    .max(100)
    .default(0)
    .describe(
      'The default tax/VAT percentage applied to services and events, e.g., 19 for 19% VAT. Must be between 0 and 100. Set to 0 if no tax applies. Defaults to 0 if not specified.',
    ),
});

export type BookingPageToolParameters = z.infer<typeof bookingPageToolParameters>;
