/**
 * TypeScript types for the 6 main building blocks of the OskarOS Booking Page.
 * Extracted from the bookingPageToolParameters Zod schema.
 */

// ============================================================================
// 1. HEADER
// ============================================================================

/** Header configuration for the booking page banner and branding */
export interface BookingPageHeader {
  /** Page title displayed to clients, e.g., "Sunny Yoga Bookings". 1–30 chars. */
  page_title: string;
  /** Short engaging slogan, e.g., "Book Your Zen Today!". 1–50 chars. */
  tagLine: string;
  /** Stock photo keywords for banner, e.g., "yoga studio interior". */
  backgroundImage: string;
  /** Background color for text elements in hex, e.g., "#FFFFFF". */
  letterBg: string;
  /** Text color in hex, e.g., "#000000". */
  color: string;
  /** Overall background color in hex, e.g., "#F5F5F5". */
  bgColor: string;
  /** Business name, e.g., "Sunny Yoga Studio". */
  organization_name: string;
  /** Whether to display page title in header. */
  page_title_header: boolean;
}

// ============================================================================
// 2. FOOTER
// ============================================================================

/** Footer/tickets configuration for the booking page */
export interface BookingPageFooter {
  /** Name for event tickets, e.g., "Class Passes". 1–30 chars. */
  tickets_name: string;
  /** Description of event tickets, e.g., "Join our yoga classes!". 1–60 chars. */
  tickets_description: string;
}

// ============================================================================
// 3. EVENTS (Series)
// ============================================================================

/** Single event occurrence within a series */
export interface EventOccurrence {
  /** Unique numeric ID for the event. */
  id: number;
  /** Event start time as ISO 8601 string, e.g., "2025-09-20T18:00:00Z". */
  start: string;
  /** Event end time as ISO 8601 string, e.g., "2025-09-20T19:00:00Z". */
  end: string;
}

/** Extra/add-on for an event series */
export interface EventExtra {
  extra: {
    extra_version: {
      /** Unique string ID for the extra. */
      id: string;
      /** Name of the add-on, e.g., "Yoga Mat Rental". 1–30 chars. */
      name: string;
      /** Description of the add-on. 1–80 chars. */
      description: string;
      /** Additional price, e.g., 5 for $5. */
      price: number;
      /** Tax percentage, e.g., 8 for 8%. */
      tax: number;
      /** Whether cost repeats per duration unit. */
      repeat: boolean;
    };
  };
}

/** Event series (recurring events/classes) */
export interface EventSeries {
  /** Unique numeric ID for the series. */
  id: number;
  /** Client-facing name, e.g., "Yoga Flow". 1–30 chars. */
  name: string;
  /** Stock photo keywords, e.g., "yoga class group". */
  image: string;
  /** Icon identifier, e.g., "yoga-pose". */
  icon: string;
  /** Whether to display on booking page. */
  show_on_bookingpage: boolean;
  /** Whether restricted to admins only. */
  admin_only: boolean;
  /** Display order (lower = first). */
  listOrder: number;
  /** Individual event occurrences in this series. */
  events: EventOccurrence[];
  /** Detailed description. 1–500 chars. */
  description: string;
  /** Price per event, e.g., 15 for $15. */
  price: number;
  /** Unique string ID for the series. */
  series_id: string;
  /** Number of available slots per event. */
  slots: number;
  /** Resource assigned to the series. */
  resources: {
    /** Resource ID linked to this series. */
    id: number;
  };
  /** Optional add-ons for the series. */
  series_extra: EventExtra[];
}

// ============================================================================
// 4. SERVICES
// ============================================================================

/** Extra/add-on for a service */
export interface ServiceExtra {
  extra: {
    extra_version: {
      /** Unique string ID for the extra. */
      id: string;
      /** Name of the add-on, e.g., "Deep Conditioning". 1–30 chars. */
      name: string;
      /** Description of the add-on. 1–80 chars. */
      description: string;
      /** Additional price, e.g., 10 for $10. */
      price: number;
      /** Tax percentage, e.g., 8 for 8%. */
      tax: number;
      /** Whether cost repeats per duration unit. */
      repeat: boolean;
    };
  };
}

/** Service group for organizing services */
export interface ServiceGroup {
  groups: {
    /** Unique numeric ID for the group. */
    id: number;
    /** Group name, e.g., "Haircuts". 1–30 chars. */
    name: string;
  };
}

/** Resource linked to a service */
export interface ServiceResource {
  resources: {
    /** Resource ID linked to this service. */
    id: number;
  };
}

/** Time slot range units */
export type TimeSlotsRange = 'month' | 'week' | 'min' | 'day' | 'night' | 'quarter' | 'hour' | 'year';

/** Bookable service */
export interface Service {
  /** Unique numeric ID for the service. */
  id: number;
  /** Client-facing name, e.g., "30-Minute Haircut". 1–30 chars. */
  name: string;
  /** Stock photo keywords or null for icon. */
  image: string | null;
  /** Icon identifier or null. */
  icon: string | null;
  /** Whether to display on booking page. */
  show_on_bookingpage: boolean;
  /** Whether restricted to admins only. */
  admin_only: boolean;
  /** Whether to hide duration from clients. */
  hide_duration: boolean;
  /** Optional add-ons for the service. */
  service_extra: ServiceExtra[];
  /** Resources assigned to the service. */
  resource_service: ServiceResource[];
  /** Display order (lower = first). */
  listOrder: number;
  /** Brief description. 1–120 chars. */
  description: string;
  /** Additional details. 1–400 chars. */
  moreInformation: string;
  /** Groups this service belongs to. */
  service_groups: ServiceGroup[];
  /** Service price, e.g., 25 for $25. */
  price: number;
  /** Duration in the specified time slot range. */
  duration: number;
  /** Unit of time for duration. */
  timeSlotsRange: TimeSlotsRange;
  /** Whether clients can select flexible time slots. */
  flexTimeslots: boolean;
  /** Minimum duration for flexible slots. */
  minDuration: number;
  /** Maximum duration for flexible slots. */
  maxDuration: number;
}

// ============================================================================
// 5. RESOURCES
// ============================================================================

/** Resource group for organizing resources */
export interface ResourceGroup {
  groups: {
    /** Unique numeric ID for the group. */
    id: number;
    /** Group name, e.g., "Instructors". 1–30 chars. */
    name: string;
  };
}

/** Resource category */
export interface ResourceCategory {
  /** Unique numeric ID for the category. */
  id: number;
  /** Category name. 1–50 chars. */
  name: string;
}

/** Time range for availability */
export interface TimeRange {
  /** Start time in HH:MM (24h) format, e.g., "09:00". */
  start: string;
  /** End time in HH:MM (24h) format, e.g., "17:30". */
  end: string;
}

/** Daily availability for a resource */
export interface DayAvailability {
  /** Day of the week (0 = Sunday, 6 = Saturday). */
  day: number;
  /** Time ranges when resource is available. */
  times: TimeRange[];
}

/** Subresource for fungible capacity tracking */
export interface Subresource {
  /** Name of the unit, e.g., "Bike 1". 1–30 chars. */
  name: string;
}

/** Bookable resource (staff member, room, equipment, etc.) */
export interface Resource {
  /** Unique numeric ID for the resource. */
  id: number;
  /** Client-facing name, e.g., "Barber Joe". 1–30 chars. */
  name: string;
  /** Stock photo keywords or null for icon. */
  imageSrc: string | null;
  /** Icon identifier or null. */
  icon: string | null;
  /** Whether to display on booking page. */
  show_on_bookingpage: boolean;
  /** Whether restricted to admins only. */
  admin_only: boolean;
  /** Display order (lower = first). */
  listOrder: number;
  /** Brief description. 1–120 chars. */
  description: string;
  /** Additional details. 1–400 chars. */
  moreInformation: string;
  /** Groups this resource belongs to. */
  resources_groups: ResourceGroup[];
  /** Category ID or null if uncategorized. */
  category_id: number | null;
  /** Category object or null. */
  category: ResourceCategory | null;
  /** Whether this is a staff member. */
  staff_member: boolean;
  /** Whether multiple clients can book simultaneously. */
  multipleBookable: boolean;
  /** Max simultaneous bookings if multipleBookable. */
  multipleBookings: number;
  /** Weekly availability schedule. */
  available: DayAvailability[];
  /** Whether to track fungible capacity via subresources. */
  use_subresources: boolean;
  /** Whether clients can pick a specific subresource. */
  allow_subresource_selection: boolean;
  /** Individual units for fungible capacity. */
  subresources: Subresource[];
}

// ============================================================================
// 6. TEXT SECTIONS
// ============================================================================

/** Image layout options for text sections */
export type TextSectionImageLayout = 'hero' | 'left' | 'right' | 'none';

/** Marketing text section for the booking page */
export interface TextSection {
  /** Main heading, e.g., "About Us". 1–80 chars. */
  heading: string;
  /** Supporting subline. 1–120 chars. */
  subline: string;
  /** Body text. Up to 10,000 chars. */
  content: string;
  /** True for dark background with light text. */
  colors_inverted: boolean;
  /** Stock photo keywords or null for no image. */
  image: string | null;
  /** Image layout: "hero", "left", "right", or "none". */
  imageLayout: TextSectionImageLayout;
}

/** Collection of text sections at different positions */
export interface TextSections {
  /** Sections displayed BEFORE services (e.g., "About Us"). */
  beforeServices: TextSection[];
  /** Sections displayed BETWEEN services and resources (e.g., "Meet the Team"). */
  beforeResources: TextSection[];
  /** Sections displayed AFTER resources (e.g., contact info, testimonials). */
  beforeFooter: TextSection[];
}

// ============================================================================
// COMPLETE BOOKING PAGE TYPE
// ============================================================================

/** Complete booking page configuration */
export interface BookingPage {
  /** Header/banner configuration. */
  header: BookingPageHeader;
  /** Footer/tickets configuration. */
  footer: BookingPageFooter;
  /** Display settings for layout. */
  displaySettings: {
    /** Section headings. */
    start_event_string: string;
    start_service_string: string;
    start_resource_string: string;
    /** Show images on front page. */
    frontpage_show_event_image: boolean;
    frontpage_show_service_image: boolean;
    frontpage_show_resource_image: boolean;
    /** Layout style (horizontal/vertical). */
    event_squared: boolean;
    service_squared: boolean;
    resource_squared: boolean;
    /** Show images on second page. */
    second_show_event_image: boolean;
    second_show_service_image: boolean;
    second_show_resource_image: boolean;
    /** Cart settings. */
    disable_cart: boolean;
    /** Default picks for second page. */
    second_resource_pick: string;
    second_service_pick: string;
  };
  /** Marketing text sections. */
  textSections: TextSections;
}

/** Full booking page tool parameters */
export interface BookingPageToolParams {
  /** Booking page configuration. */
  bookingPage: BookingPage;
  /** Available services. */
  services: Service[];
  /** Available resources. */
  resources: Resource[];
  /** Event series. */
  series: EventSeries[];
  /** Currency symbol or code. */
  currency: string;
  /** Default tax percentage. */
  basic_tax: number;
}
