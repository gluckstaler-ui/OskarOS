import { useState } from "react";
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  MapPin,
  User,
  Dumbbell,
  Package,
  Home,
  Layers,
  Building2,
  Stethoscope,
  Scissors,
  Briefcase,
  Wrench,
  GraduationCap,
  Compass,
  Ticket,
  Music,
  Camera,
  Tent,
  Sparkles,
  Waves,
  Microscope,
  BookOpen,
  MessageSquare,
  HelpCircle,
  Bug,
  Lightbulb,
  CreditCard,
  Send,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// =============================================================================
// ARCHETYPE 1: HEALTHCARE APPOINTMENT
// For: Primary Care, Specialists, Dental, Mental Health, Physical Therapy, etc.
// =============================================================================

function HealthcareAppointmentTemplate() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const providers = [
    { id: "dr-smith", name: "Dr. Sarah Smith", specialty: "Family Medicine", avatar: "SS" },
    { id: "dr-chen", name: "Dr. Michael Chen", specialty: "Internal Medicine", avatar: "MC" },
    { id: "dr-patel", name: "Dr. Priya Patel", specialty: "Pediatrics", avatar: "PP" },
  ];

  const appointmentTypes = [
    { id: "new-patient", name: "New Patient Visit", duration: "45 min" },
    { id: "follow-up", name: "Follow-up Visit", duration: "20 min" },
    { id: "annual", name: "Annual Physical", duration: "60 min" },
  ];

  const times = ["9:00 AM", "10:30 AM", "2:00 PM", "3:30 PM"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Choose Provider</h4>
        <div className="space-y-2">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setSelectedProvider(provider.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                selectedProvider === provider.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-sm">
                {provider.avatar}
              </div>
              <div>
                <p className="font-medium">{provider.name}</p>
                <p className="text-sm text-muted-foreground">{provider.specialty}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedProvider && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Appointment Type</h4>
          <div className="space-y-2">
            {appointmentTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                  selectedType === type.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span className="font-medium">{type.name}</span>
                <span className="text-sm text-muted-foreground">{type.duration}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedType && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date()}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Time</h4>
          <div className="grid grid-cols-2 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedProvider || !selectedType || !selectedDate || !selectedTime}>
        Book Appointment
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 2: BEAUTY & PERSONAL CARE
// For: Salons, Barbershops, Spas, Nail Salons, Med Spas, Tattoo Studios, etc.
// =============================================================================

function BeautyPersonalCareTemplate() {
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const services = [
    { id: "haircut", name: "Haircut & Style", duration: "45 min", price: "$55" },
    { id: "color", name: "Full Color", duration: "90 min", price: "$120" },
    { id: "blowout", name: "Blowout", duration: "30 min", price: "$40" },
    { id: "treatment", name: "Deep Conditioning", duration: "20 min", price: "$35" },
  ];

  const staff = [
    { id: "any", name: "No Preference", available: true },
    { id: "jessica", name: "Jessica", available: true },
    { id: "marcus", name: "Marcus", available: true },
    { id: "emily", name: "Emily", available: false },
  ];

  const times = ["10:00 AM", "11:30 AM", "1:00 PM", "3:00 PM", "4:30 PM"];

  const toggleService = (id: string) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const totalDuration = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((acc, s) => acc + parseInt(s.duration), 0);

  const totalPrice = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((acc, s) => acc + parseInt(s.price.replace("$", "")), 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Services</h4>
        <div className="space-y-2">
          {services.map((service) => (
            <button
              key={service.id}
              onClick={() => toggleService(service.id)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                selectedServices.includes(service.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                    selectedServices.includes(service.id)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {selectedServices.includes(service.id) && (
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-medium">{service.name}</p>
                  <p className="text-sm text-muted-foreground">{service.duration}</p>
                </div>
              </div>
              <span className="font-semibold">{service.price}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedServices.length > 0 && (
        <>
          <div className="flex justify-between p-3 bg-muted/50 rounded-lg text-sm">
            <span className="text-muted-foreground">
              {selectedServices.length} service{selectedServices.length > 1 ? "s" : ""} · {totalDuration} min
            </span>
            <span className="font-semibold">${totalPrice}</span>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Preferred Stylist</h4>
            <div className="flex flex-wrap gap-2">
              {staff.map((person) => (
                <button
                  key={person.id}
                  onClick={() => person.available && setSelectedStaff(person.id)}
                  disabled={!person.available}
                  className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                    !person.available
                      ? "opacity-50 cursor-not-allowed"
                      : selectedStaff === person.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {person.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {selectedStaff && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date()}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Time</h4>
          <div className="grid grid-cols-3 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button
        className="w-full"
        disabled={selectedServices.length === 0 || !selectedStaff || !selectedDate || !selectedTime}
      >
        Book Appointment
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 3: PROFESSIONAL CONSULTATION
// For: Lawyers, Accountants, Financial Advisors, Business Consultants, Coaches
// =============================================================================

function ProfessionalConsultationTemplate() {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const consultationTypes = [
    {
      id: "discovery",
      name: "Free Discovery Call",
      duration: "15 min",
      price: "Free",
      description: "Quick intro to discuss your needs",
    },
    {
      id: "consultation",
      name: "Initial Consultation",
      duration: "60 min",
      price: "$150",
      description: "In-depth review of your situation",
    },
    {
      id: "strategy",
      name: "Strategy Session",
      duration: "90 min",
      price: "$250",
      description: "Comprehensive planning session",
    },
  ];

  const dates = [
    { id: "today", label: "Today", date: "Dec 16" },
    { id: "tomorrow", label: "Tomorrow", date: "Dec 17" },
    { id: "wed", label: "Wed", date: "Dec 18" },
    { id: "thu", label: "Thu", date: "Dec 19" },
  ];

  const times = ["9:00 AM", "11:00 AM", "2:00 PM", "4:00 PM"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Consultation Type</h4>
        <div className="space-y-2">
          {consultationTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${
                selectedType === type.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{type.name}</span>
                <span className={`font-semibold ${type.price === "Free" ? "text-green-600" : ""}`}>
                  {type.price}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {type.duration} · {type.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selectedType && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
          <div className="grid grid-cols-4 gap-2">
            {dates.map((date) => (
              <button
                key={date.id}
                onClick={() => setSelectedDate(date.id)}
                className={`p-2 rounded-lg border text-center transition-colors ${
                  selectedDate === date.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <p className="text-xs text-muted-foreground">{date.label}</p>
                <p className="font-medium text-sm">{date.date}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Time</h4>
          <div className="grid grid-cols-2 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedType || !selectedDate || !selectedTime}>
        Schedule Consultation
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 4: HOME & FIELD SERVICE
// For: Handyman, Plumber, Electrician, HVAC, Cleaning, Landscaping
// =============================================================================

function HomeFieldServiceTemplate() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);

  const services = [
    { id: "repair", name: "Repair Service", price: "From $89", estimate: "1-2 hours" },
    { id: "maintenance", name: "Maintenance Visit", price: "$129", estimate: "1 hour" },
    { id: "installation", name: "New Installation", price: "Quote needed", estimate: "2-4 hours" },
    { id: "emergency", name: "Emergency Service", price: "$149 + parts", estimate: "Same day" },
  ];

  const dates = ["Mon, Dec 16", "Tue, Dec 17", "Wed, Dec 18", "Thu, Dec 19"];

  const timeWindows = [
    { id: "morning", label: "Morning", time: "8 AM - 12 PM" },
    { id: "afternoon", label: "Afternoon", time: "12 PM - 5 PM" },
    { id: "evening", label: "Evening", time: "5 PM - 8 PM" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">What do you need?</h4>
        <div className="grid grid-cols-2 gap-2">
          {services.map((service) => (
            <button
              key={service.id}
              onClick={() => setSelectedService(service.id)}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedService === service.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <p className="font-medium text-sm">{service.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{service.estimate}</p>
              <p className="text-sm font-semibold text-primary mt-1">{service.price}</p>
            </button>
          ))}
        </div>
      </div>

      {selectedService && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Preferred Date</h4>
          <div className="grid grid-cols-2 gap-2">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedDate === date
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {date}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Arrival Window</h4>
          <div className="space-y-2">
            {timeWindows.map((window) => (
              <button
                key={window.id}
                onClick={() => setSelectedWindow(window.id)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  selectedWindow === window.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span className="font-medium">{window.label}</span>
                <span className="text-sm text-muted-foreground">{window.time}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedService || !selectedDate || !selectedWindow}>
        Request Appointment
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 5: FITNESS & STUDIO CLASS
// For: Yoga, Pilates, CrossFit, Spin, Dance, Martial Arts, Swimming Classes
// =============================================================================

function FitnessStudioClassTemplate() {
  const [selectedDay, setSelectedDay] = useState("today");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  const days = [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "wed", label: "Wed" },
    { id: "thu", label: "Thu" },
  ];

  const classes = [
    {
      id: "yoga-morning",
      name: "Vinyasa Flow",
      instructor: "Sarah",
      time: "7:00 AM",
      duration: "60 min",
      spots: 4,
      level: "All Levels",
    },
    {
      id: "spin",
      name: "Power Spin",
      instructor: "Mike",
      time: "12:00 PM",
      duration: "45 min",
      spots: 2,
      level: "Intermediate",
    },
    {
      id: "hiit",
      name: "HIIT Blast",
      instructor: "Alex",
      time: "5:30 PM",
      duration: "45 min",
      spots: 8,
      level: "Advanced",
    },
    {
      id: "yoga-evening",
      name: "Restorative Yoga",
      instructor: "Sarah",
      time: "7:00 PM",
      duration: "75 min",
      spots: 6,
      level: "Beginner",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        {days.map((day) => (
          <button
            key={day.id}
            onClick={() => setSelectedDay(day.id)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              selectedDay === day.id ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {classes.map((cls) => (
          <button
            key={cls.id}
            onClick={() => setSelectedClass(cls.id)}
            className={`w-full p-3 rounded-lg border text-left transition-colors ${
              selectedClass === cls.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{cls.name}</p>
                  <Badge variant="outline" className="text-xs">
                    {cls.level}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {cls.time} · {cls.duration} · {cls.instructor}
                </p>
              </div>
              <Badge variant={cls.spots <= 3 ? "destructive" : "secondary"}>
                {cls.spots} spots
              </Badge>
            </div>
          </button>
        ))}
      </div>

      <Button className="w-full" disabled={!selectedClass}>
        Reserve Spot
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 6: WORKSHOP & COURSE
// For: Cooking Classes, Art Workshops, Coding Bootcamps, Language Schools
// =============================================================================

function WorkshopCourseTemplate() {
  const [selectedWorkshop, setSelectedWorkshop] = useState<string | null>(null);
  const [tickets, setTickets] = useState(1);

  const workshops = [
    {
      id: "pottery",
      name: "Intro to Pottery",
      date: "Sat, Dec 21",
      time: "10:00 AM - 1:00 PM",
      price: 85,
      spotsLeft: 4,
      instructor: "Maria Chen",
    },
    {
      id: "pasta",
      name: "Fresh Pasta Making",
      date: "Sun, Dec 22",
      time: "2:00 PM - 5:00 PM",
      price: 95,
      spotsLeft: 6,
      instructor: "Chef Antonio",
    },
    {
      id: "photography",
      name: "Night Photography",
      date: "Fri, Dec 27",
      time: "6:00 PM - 9:00 PM",
      price: 75,
      spotsLeft: 8,
      instructor: "James Wilson",
    },
  ];

  const selectedWorkshopData = workshops.find((w) => w.id === selectedWorkshop);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Upcoming Workshops</h4>
        <div className="space-y-2">
          {workshops.map((workshop) => (
            <button
              key={workshop.id}
              onClick={() => setSelectedWorkshop(workshop.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${
                selectedWorkshop === workshop.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{workshop.name}</p>
                  <p className="text-sm text-muted-foreground">{workshop.date}</p>
                  <p className="text-sm text-muted-foreground">
                    {workshop.time} · {workshop.instructor}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">${workshop.price}</p>
                  <p className="text-xs text-muted-foreground">{workshop.spotsLeft} spots left</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedWorkshop && selectedWorkshopData && (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Number of Participants</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTickets(Math.max(1, tickets - 1))}
                className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted"
              >
                -
              </button>
              <span className="font-medium w-4 text-center">{tickets}</span>
              <button
                onClick={() => setTickets(Math.min(selectedWorkshopData.spotsLeft, tickets + 1))}
                className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="font-medium">Total</span>
            <span className="font-bold text-lg">${selectedWorkshopData.price * tickets}</span>
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedWorkshop}>
        Register Now
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 7: TOUR & EXPERIENCE
// For: City Tours, Food Tours, Adventure Activities, Wine Tastings
// =============================================================================

function TourExperienceTemplate() {
  const [selectedTour, setSelectedTour] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [guests, setGuests] = useState({ adults: 2, children: 0 });

  const tours = [
    {
      id: "walking",
      name: "Historic Downtown Walk",
      duration: "2.5 hours",
      price: 45,
      rating: "4.9",
      reviews: 128,
    },
    {
      id: "food",
      name: "Local Food & Market Tour",
      duration: "3 hours",
      price: 75,
      rating: "4.8",
      reviews: 89,
    },
    {
      id: "sunset",
      name: "Sunset Kayak Adventure",
      duration: "2 hours",
      price: 65,
      rating: "5.0",
      reviews: 42,
    },
  ];

  const dates = [
    { id: "dec-18", label: "Wed 18", available: true },
    { id: "dec-19", label: "Thu 19", available: true },
    { id: "dec-20", label: "Fri 20", available: false },
    { id: "dec-21", label: "Sat 21", available: true },
  ];

  const selectedTourData = tours.find((t) => t.id === selectedTour);
  const totalGuests = guests.adults + guests.children;
  const totalPrice = selectedTourData
    ? selectedTourData.price * guests.adults + selectedTourData.price * 0.5 * guests.children
    : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {tours.map((tour) => (
          <button
            key={tour.id}
            onClick={() => setSelectedTour(tour.id)}
            className={`w-full p-3 rounded-lg border text-left transition-colors ${
              selectedTour === tour.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{tour.name}</p>
                <p className="text-sm text-muted-foreground">{tour.duration}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-yellow-500">★</span>
                  <span className="text-sm font-medium">{tour.rating}</span>
                  <span className="text-sm text-muted-foreground">({tour.reviews})</span>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-primary">${tour.price}</p>
                <p className="text-xs text-muted-foreground">per person</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedTour && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
            <div className="grid grid-cols-4 gap-2">
              {dates.map((date) => (
                <button
                  key={date.id}
                  onClick={() => date.available && setSelectedDate(date.id)}
                  disabled={!date.available}
                  className={`p-2 rounded-lg border text-center transition-colors ${
                    !date.available
                      ? "opacity-50 cursor-not-allowed"
                      : selectedDate === date.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <p className="font-medium text-sm">{date.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Party Size</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2">
                <span className="text-sm">Adults</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setGuests({ ...guests, adults: Math.max(1, guests.adults - 1) })}
                    className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm"
                  >
                    -
                  </button>
                  <span className="font-medium w-4 text-center">{guests.adults}</span>
                  <button
                    onClick={() => setGuests({ ...guests, adults: guests.adults + 1 })}
                    className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between p-2">
                <span className="text-sm">Children (half price)</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      setGuests({ ...guests, children: Math.max(0, guests.children - 1) })
                    }
                    className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm"
                  >
                    -
                  </button>
                  <span className="font-medium w-4 text-center">{guests.children}</span>
                  <button
                    onClick={() => setGuests({ ...guests, children: guests.children + 1 })}
                    className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {selectedDate && (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span className="font-medium">{totalGuests} guests</span>
              <span className="font-bold text-lg">${totalPrice.toFixed(0)}</span>
            </div>
          )}
        </>
      )}

      <Button className="w-full" disabled={!selectedTour || !selectedDate}>
        Book Experience
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 8: WORKSPACE & MEETING ROOM
// For: Coworking Spaces, Conference Rooms, Private Offices, Training Rooms
// =============================================================================

function WorkspaceMeetingRoomTemplate() {
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<string>("1hr");

  const spaces = [
    {
      id: "hot-desk",
      name: "Hot Desk",
      capacity: 1,
      rate: "$15",
      per: "hour",
      amenities: ["WiFi", "Power"],
    },
    {
      id: "meeting-small",
      name: "Small Meeting Room",
      capacity: 4,
      rate: "$35",
      per: "hour",
      amenities: ["TV", "Whiteboard", "Video conf"],
    },
    {
      id: "meeting-large",
      name: "Large Conference Room",
      capacity: 12,
      rate: "$75",
      per: "hour",
      amenities: ["TV", "Video conf", "Catering available"],
    },
    {
      id: "private-office",
      name: "Private Office",
      capacity: 4,
      rate: "$150",
      per: "day",
      amenities: ["Lockable", "Phone", "Printer access"],
    },
  ];

  const durations = [
    { id: "1hr", label: "1 hour" },
    { id: "2hr", label: "2 hours" },
    { id: "half", label: "Half day" },
    { id: "full", label: "Full day" },
  ];

  const times = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Start Time</h4>
          <div className="grid grid-cols-3 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedTime && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Duration</h4>
          <div className="grid grid-cols-4 gap-2">
            {durations.map((d) => (
              <button
                key={d.id}
                onClick={() => setDuration(d.id)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  duration === d.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Available Spaces</h4>
        <div className="space-y-2">
          {spaces.map((space) => (
            <button
              key={space.id}
              onClick={() => setSelectedSpace(space.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${
                selectedSpace === space.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{space.name}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Up to {space.capacity}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {space.amenities.map((amenity) => (
                      <span
                        key={amenity}
                        className="text-xs bg-muted px-1.5 py-0.5 rounded"
                      >
                        {amenity}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">{space.rate}</p>
                  <p className="text-xs text-muted-foreground">/{space.per}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button className="w-full" disabled={!selectedSpace || !selectedDate || !selectedTime}>
        Reserve Space
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 9: SPORTS FACILITY
// For: Tennis Courts, Padel, Soccer Fields, Basketball, Golf, Pool, Climbing
// =============================================================================

function SportsFacilityTemplate() {
  const [selectedFacility, setSelectedFacility] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const facilities = [
    { id: "court-1", name: "Court 1", type: "Indoor", surface: "Hard court" },
    { id: "court-2", name: "Court 2", type: "Indoor", surface: "Hard court" },
    { id: "court-3", name: "Court 3", type: "Outdoor", surface: "Clay" },
  ];

  const slots = [
    { id: "8-9", time: "8:00 - 9:00 AM", price: "$30", available: true },
    { id: "9-10", time: "9:00 - 10:00 AM", price: "$30", available: true },
    { id: "10-11", time: "10:00 - 11:00 AM", price: "$35", available: false },
    { id: "5-6", time: "5:00 - 6:00 PM", price: "$45", available: true },
    { id: "6-7", time: "6:00 - 7:00 PM", price: "$45", available: true },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Court</h4>
          <div className="grid grid-cols-3 gap-2">
            {facilities.map((facility) => (
              <button
                key={facility.id}
                onClick={() => setSelectedFacility(facility.id)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  selectedFacility === facility.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Dumbbell className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="font-medium text-sm">{facility.name}</p>
                <p className="text-xs text-muted-foreground">{facility.type}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedFacility && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Available Time Slots</h4>
          <div className="grid gap-2">
            {slots.map((slot) => (
              <button
                key={slot.id}
                onClick={() => slot.available && setSelectedSlot(slot.id)}
                disabled={!slot.available}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  !slot.available
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : selectedSlot === slot.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span className={`font-medium ${!slot.available ? "line-through" : ""}`}>
                  {slot.time}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-primary font-semibold">{slot.price}</span>
                  {!slot.available && (
                    <Badge variant="outline" className="text-xs">
                      Booked
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedFacility || !selectedDate || !selectedSlot}>
        Reserve Court
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 10: EVENT VENUE
// For: Wedding Venues, Party Spaces, Corporate Events, Performance Venues
// =============================================================================

function EventVenueTemplate() {
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState<string>("50-100");

  const venues = [
    {
      id: "ballroom",
      name: "Grand Ballroom",
      capacity: 200,
      minHours: 4,
      rate: "$500/hr",
    },
    {
      id: "garden",
      name: "Garden Terrace",
      capacity: 100,
      minHours: 3,
      rate: "$350/hr",
    },
    {
      id: "lounge",
      name: "Private Lounge",
      capacity: 40,
      minHours: 2,
      rate: "$200/hr",
    },
  ];

  const eventTypes = [
    { id: "wedding", label: "Wedding" },
    { id: "corporate", label: "Corporate" },
    { id: "birthday", label: "Birthday" },
    { id: "other", label: "Other" },
  ];

  const guestRanges = ["20-50", "50-100", "100-150", "150+"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Event Type</h4>
        <div className="grid grid-cols-4 gap-2">
          {eventTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setEventType(type.id)}
              className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                eventType === type.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Expected Guests</h4>
        <div className="grid grid-cols-4 gap-2">
          {guestRanges.map((range) => (
            <button
              key={range}
              onClick={() => setGuestCount(range)}
              className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                guestCount === range
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Available Venues</h4>
        <div className="space-y-2">
          {venues.map((venue) => (
            <button
              key={venue.id}
              onClick={() => setSelectedVenue(venue.id)}
              className={`w-full p-3 rounded-lg border text-left transition-colors ${
                selectedVenue === venue.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{venue.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Up to {venue.capacity} guests · {venue.minHours}hr minimum
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">{venue.rate}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button className="w-full" disabled={!selectedVenue || !eventType}>
        Request Quote
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 11: CREATIVE STUDIO
// For: Photo Studios, Recording Studios, Rehearsal Spaces, Podcast Studios
// =============================================================================

function CreativeStudioTemplate() {
  const [selectedStudio, setSelectedStudio] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  const studios = [
    {
      id: "photo-a",
      name: "Studio A - Daylight",
      sqft: "800 sq ft",
      features: ["Natural light", "Cyclorama", "Makeup station"],
    },
    {
      id: "photo-b",
      name: "Studio B - Blackout",
      sqft: "600 sq ft",
      features: ["Full blackout", "Lighting grid", "Backdrop system"],
    },
    {
      id: "podcast",
      name: "Podcast Room",
      sqft: "200 sq ft",
      features: ["Soundproofed", "4 mics", "Mixer included"],
    },
  ];

  const packages = [
    { id: "2hr", label: "2 Hours", price: "$150" },
    { id: "half", label: "Half Day (4hr)", price: "$275" },
    { id: "full", label: "Full Day (8hr)", price: "$450" },
  ];

  const times = ["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Start Time</h4>
          <div className="grid grid-cols-3 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedTime && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Studio</h4>
          <div className="space-y-2">
            {studios.map((studio) => (
              <button
                key={studio.id}
                onClick={() => setSelectedStudio(studio.id)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedStudio === studio.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Camera className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{studio.name}</p>
                    <p className="text-sm text-muted-foreground">{studio.sqft}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {studio.features.map((feature) => (
                        <span key={feature} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedStudio && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Booking Duration</h4>
          <div className="grid grid-cols-3 gap-2">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => setSelectedPackage(pkg.id)}
                className={`p-3 rounded-lg border text-center transition-colors ${
                  selectedPackage === pkg.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <p className="font-medium text-sm">{pkg.label}</p>
                <p className="text-primary font-semibold">{pkg.price}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedStudio || !selectedDate || !selectedTime || !selectedPackage}>
        Book Studio
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 12: ACCOMMODATION
// For: Hotels, Vacation Rentals, Campsites, Glamping
// =============================================================================

function AccommodationTemplate() {
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const rooms = [
    {
      id: "standard",
      name: "Standard Room",
      price: 129,
      perks: "Queen bed · City view · 280 sq ft",
      amenities: ["WiFi", "TV", "AC"],
    },
    {
      id: "deluxe",
      name: "Deluxe Suite",
      price: 229,
      perks: "King bed · Ocean view · 450 sq ft",
      amenities: ["WiFi", "TV", "AC", "Balcony", "Mini bar"],
    },
    {
      id: "penthouse",
      name: "Penthouse Suite",
      price: 499,
      perks: "2 King beds · Panoramic view · 900 sq ft",
      amenities: ["WiFi", "TV", "AC", "Terrace", "Kitchen", "Jacuzzi"],
    },
  ];

  const nights = 3;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg text-center">
        <div>
          <p className="text-xs text-muted-foreground">Check-in</p>
          <p className="font-medium">Dec 20</p>
          <p className="text-xs text-muted-foreground">After 3 PM</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Check-out</p>
          <p className="font-medium">Dec 23</p>
          <p className="text-xs text-muted-foreground">Before 11 AM</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Guests</p>
          <p className="font-medium">2 Adults</p>
          <p className="text-xs text-muted-foreground">0 Children</p>
        </div>
      </div>

      <div className="space-y-2">
        {rooms.map((room) => (
          <button
            key={room.id}
            onClick={() => setSelectedRoom(room.id)}
            className={`w-full p-3 rounded-lg border text-left transition-colors ${
              selectedRoom === room.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{room.name}</p>
                <p className="text-sm text-muted-foreground">{room.perks}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {room.amenities.map((amenity) => (
                    <span key={amenity} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {amenity}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-primary">${room.price}</p>
                <p className="text-xs text-muted-foreground">/night</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedRoom && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <span className="text-sm text-muted-foreground">
            {nights} nights total
          </span>
          <span className="font-bold text-lg">
            ${(rooms.find((r) => r.id === selectedRoom)?.price || 0) * nights}
          </span>
        </div>
      )}

      <Button className="w-full" disabled={!selectedRoom}>
        Reserve Room
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 13: EQUIPMENT RENTAL
// For: Camera Gear, Tools, Sports Equipment, Party Supplies
// =============================================================================

function EquipmentRentalTemplate() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const equipment = [
    {
      id: "camera",
      name: "Canon EOS R5",
      category: "Camera Body",
      rate: "$75/day",
      available: true,
    },
    {
      id: "lens-24-70",
      name: "RF 24-70mm f/2.8",
      category: "Lens",
      rate: "$35/day",
      available: true,
    },
    {
      id: "lens-70-200",
      name: "RF 70-200mm f/2.8",
      category: "Lens",
      rate: "$45/day",
      available: true,
    },
    {
      id: "tripod",
      name: "Carbon Fiber Tripod",
      category: "Support",
      rate: "$15/day",
      available: false,
    },
    {
      id: "lighting",
      name: "LED Light Kit (3pc)",
      category: "Lighting",
      rate: "$50/day",
      available: true,
    },
  ];

  const toggleItem = (id: string) => {
    setSelectedItems((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const rentalDays = 3;
  const totalPerDay = equipment
    .filter((e) => selectedItems.includes(e.id))
    .reduce((acc, e) => acc + parseInt(e.rate.replace(/[^0-9]/g, "")), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 p-3 bg-muted/50 rounded-lg">
        <div>
          <p className="text-xs text-muted-foreground">Pick up</p>
          <p className="font-medium">Dec 16, 9 AM</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Return</p>
          <p className="font-medium">Dec 18, 5 PM</p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Equipment</h4>
        <div className="space-y-2">
          {equipment.map((item) => (
            <button
              key={item.id}
              onClick={() => item.available && toggleItem(item.id)}
              disabled={!item.available}
              className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                !item.available
                  ? "opacity-50 cursor-not-allowed"
                  : selectedItems.includes(item.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                    selectedItems.includes(item.id)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground"
                  }`}
                >
                  {selectedItems.includes(item.id) && (
                    <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">{item.category}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-primary font-medium">{item.rate}</span>
                {!item.available && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    Rented
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Daily rate</span>
            <span>${totalPerDay}/day</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Rental period</span>
            <span>{rentalDays} days</span>
          </div>
          <div className="flex justify-between pt-2 border-t">
            <span className="font-medium">Total</span>
            <span className="font-bold text-lg">${totalPerDay * rentalDays}</span>
          </div>
        </div>
      )}

      <Button className="w-full" disabled={selectedItems.length === 0}>
        Reserve Equipment
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 14: ENTERTAINMENT VENUE
// For: Escape Rooms, Karaoke Rooms, VR/Gaming Rooms
// =============================================================================

function EntertainmentVenueTemplate() {
  const [selectedExperience, setSelectedExperience] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [partySize, setPartySize] = useState(4);

  const experiences = [
    {
      id: "escape-1",
      name: "The Haunted Manor",
      difficulty: "Hard",
      duration: "60 min",
      minPlayers: 2,
      maxPlayers: 6,
      pricePerPerson: 35,
    },
    {
      id: "escape-2",
      name: "Bank Heist",
      difficulty: "Medium",
      duration: "60 min",
      minPlayers: 2,
      maxPlayers: 8,
      pricePerPerson: 30,
    },
    {
      id: "vr",
      name: "VR Adventure Zone",
      difficulty: "All levels",
      duration: "45 min",
      minPlayers: 1,
      maxPlayers: 4,
      pricePerPerson: 40,
    },
  ];

  const times = ["10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];

  const selectedExp = experiences.find((e) => e.id === selectedExperience);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Choose Experience</h4>
          <div className="space-y-2">
            {experiences.map((exp) => (
              <button
                key={exp.id}
                onClick={() => setSelectedExperience(exp.id)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedExperience === exp.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{exp.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {exp.duration} · {exp.difficulty}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {exp.minPlayers}-{exp.maxPlayers} players
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-primary">${exp.pricePerPerson}</p>
                    <p className="text-xs text-muted-foreground">/person</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedExperience && selectedExp && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Party Size</h4>
            <div className="flex items-center justify-center gap-4 p-3 border rounded-lg">
              <button
                onClick={() => setPartySize(Math.max(selectedExp.minPlayers, partySize - 1))}
                className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted"
              >
                -
              </button>
              <span className="font-bold text-xl w-8 text-center">{partySize}</span>
              <button
                onClick={() => setPartySize(Math.min(selectedExp.maxPlayers, partySize + 1))}
                className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Select Time</h4>
            <div className="grid grid-cols-3 gap-2">
              {times.map((time) => (
                <button
                  key={time}
                  onClick={() => setSelectedTime(time)}
                  className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedTime === time
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>

          {selectedTime && (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span className="text-muted-foreground">{partySize} players</span>
              <span className="font-bold text-lg">${selectedExp.pricePerPerson * partySize}</span>
            </div>
          )}
        </>
      )}

      <Button className="w-full" disabled={!selectedExperience || !selectedDate || !selectedTime}>
        Book Experience
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 15: MULTI-LOCATION SERVICE
// For: Chain businesses, Franchises, Multi-branch operations
// =============================================================================

function MultiLocationServiceTemplate() {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const locations = [
    {
      id: "downtown",
      name: "Downtown",
      address: "123 Main Street",
      distance: "0.5 mi",
      nextAvailable: "Today 2:00 PM",
    },
    {
      id: "westside",
      name: "Westside",
      address: "456 Oak Avenue",
      distance: "2.1 mi",
      nextAvailable: "Today 3:30 PM",
    },
    {
      id: "northgate",
      name: "Northgate Mall",
      address: "789 Commerce Blvd",
      distance: "4.2 mi",
      nextAvailable: "Tomorrow 10:00 AM",
    },
  ];

  const services = [
    { id: "express", name: "Express Service", time: "15 min", price: "$25" },
    { id: "standard", name: "Standard Service", time: "30 min", price: "$45" },
    { id: "premium", name: "Premium Service", time: "60 min", price: "$85" },
  ];

  const times = ["2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM"];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Location</h4>
        <div className="space-y-2">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setSelectedLocation(loc.id)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                selectedLocation === loc.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{loc.name}</p>
                  <p className="text-sm text-muted-foreground">{loc.address}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{loc.distance}</p>
                <p className="text-xs text-green-600">{loc.nextAvailable}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedLocation && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Service</h4>
          <div className="space-y-2">
            {services.map((svc) => (
              <button
                key={svc.id}
                onClick={() => setSelectedService(svc.id)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                  selectedService === svc.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div>
                  <p className="font-medium">{svc.name}</p>
                  <p className="text-sm text-muted-foreground">{svc.time}</p>
                </div>
                <span className="font-semibold text-primary">{svc.price}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedService && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                disabled={(date) => date < new Date()}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Time</h4>
          <div className="grid grid-cols-3 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedTime === time
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!selectedLocation || !selectedService || !selectedDate || !selectedTime}
      >
        Book Appointment
      </Button>
    </div>
  );
}

// =============================================================================
// HYBRID ARCHETYPE 1: CLASSES + PRIVATE SESSIONS
// =============================================================================

function ClassesAndPrivateSessionsTemplate() {
  const [mode, setMode] = useState<"classes" | "private">("classes");
  const [selectedDay, setSelectedDay] = useState("today");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedInstructor, setSelectedInstructor] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const handleModeChange = (newMode: "classes" | "private") => {
    setMode(newMode);
    setSelectedClass(null);
    setSelectedService(null);
    setSelectedInstructor(null);
    setSelectedTime(null);
  };

  const days = [
    { id: "today", label: "Today", date: "Dec 16" },
    { id: "tomorrow", label: "Tomorrow", date: "Dec 17" },
    { id: "wed", label: "Wed", date: "Dec 18" },
    { id: "thu", label: "Thu", date: "Dec 19" },
  ];

  const groupClasses = [
    { id: "vinyasa-morning", name: "Vinyasa Flow", instructor: "Sarah", time: "7:00 AM", duration: "60 min", spots: 4, totalSpots: 12, level: "All Levels", price: "$25" },
    { id: "power-yoga", name: "Power Yoga", instructor: "Marcus", time: "12:00 PM", duration: "75 min", spots: 2, totalSpots: 10, level: "Intermediate", price: "$28" },
    { id: "yin-yoga", name: "Yin Yoga", instructor: "Sarah", time: "5:30 PM", duration: "60 min", spots: 8, totalSpots: 12, level: "Beginner", price: "$25" },
    { id: "hot-yoga", name: "Hot Yoga", instructor: "Elena", time: "7:00 PM", duration: "90 min", spots: 6, totalSpots: 15, level: "Advanced", price: "$32" },
  ];

  const privateServices = [
    { id: "private-single", name: "Private Session", duration: "60 min", price: "$95", description: "One-on-one personalized instruction" },
    { id: "private-couple", name: "Couples Session", duration: "60 min", price: "$140", description: "Private class for 2 people" },
    { id: "private-intro", name: "Intro Package (3 sessions)", duration: "60 min each", price: "$250", description: "Perfect for beginners - save $35" },
    { id: "private-assessment", name: "Assessment + Plan", duration: "90 min", price: "$120", description: "Full evaluation with custom program" },
  ];

  const instructors = [
    { id: "any", name: "No Preference", specialty: "First available", avatar: "?" },
    { id: "sarah", name: "Sarah", specialty: "Vinyasa, Yin", avatar: "S" },
    { id: "marcus", name: "Marcus", specialty: "Power, Ashtanga", avatar: "M" },
    { id: "elena", name: "Elena", specialty: "Hot, Restorative", avatar: "E" },
  ];

  const privateTimes = ["9:00 AM", "11:00 AM", "1:00 PM", "3:00 PM", "5:00 PM"];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        <button
          onClick={() => handleModeChange("classes")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "classes" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Group Classes
        </button>
        <button
          onClick={() => handleModeChange("private")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "private" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <User className="h-4 w-4" />
          Private Sessions
        </button>
      </div>

      {mode === "classes" ? (
        <>
          <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
            {days.map((day) => (
              <button
                key={day.id}
                onClick={() => { setSelectedDay(day.id); setSelectedClass(null); }}
                className={`flex-1 py-2 px-2 rounded-md text-center transition-colors ${
                  selectedDay === day.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <p className="text-xs">{day.label}</p>
                <p className="text-sm font-medium">{day.date}</p>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {groupClasses.map((cls) => (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls.id)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedClass === cls.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{cls.name}</p>
                      <Badge variant="outline" className="text-xs">{cls.level}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {cls.time} · {cls.duration} · with {cls.instructor}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cls.spots <= 3 ? "bg-red-500" : "bg-green-500"}`}
                          style={{ width: `${((cls.totalSpots - cls.spots) / cls.totalSpots) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{cls.spots}/{cls.totalSpots}</span>
                    </div>
                  </div>
                  <div className="text-right ml-3">
                    <p className="font-semibold text-primary">{cls.price}</p>
                    {cls.spots <= 3 && <Badge variant="destructive" className="text-xs mt-1">{cls.spots} left</Badge>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <Button className="w-full" disabled={!selectedClass}>Reserve Spot</Button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Select Session Type</h4>
            <div className="space-y-2">
              {privateServices.map((service) => (
                <button
                  key={service.id}
                  onClick={() => setSelectedService(service.id)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    selectedService === service.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-sm text-muted-foreground">{service.duration}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                    </div>
                    <span className="font-semibold text-primary">{service.price}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedService && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Choose Instructor</h4>
              <div className="grid grid-cols-2 gap-2">
                {instructors.map((instructor) => (
                  <button
                    key={instructor.id}
                    onClick={() => setSelectedInstructor(instructor.id)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      selectedInstructor === instructor.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                        {instructor.avatar}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{instructor.name}</p>
                        <p className="text-xs text-muted-foreground">{instructor.specialty}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedInstructor && (
            <>
              <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
                {days.map((day) => (
                  <button
                    key={day.id}
                    onClick={() => { setSelectedDay(day.id); setSelectedTime(null); }}
                    className={`flex-1 py-2 px-2 rounded-md text-center transition-colors ${
                      selectedDay === day.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <p className="text-xs">{day.label}</p>
                    <p className="text-sm font-medium">{day.date}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Available Times</h4>
                <div className="grid grid-cols-3 gap-2">
                  {privateTimes.map((time) => (
                    <button
                      key={time}
                      onClick={() => setSelectedTime(time)}
                      className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                        selectedTime === time ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
                      }`}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Button className="w-full" disabled={!selectedService || !selectedInstructor || !selectedTime}>
            Book Private Session
          </Button>
        </>
      )}
    </div>
  );
}

// =============================================================================
// HYBRID ARCHETYPE 2: ACCOMMODATION + PACKAGES
// =============================================================================

function AccommodationAndPackagesTemplate() {
  const [mode, setMode] = useState<"rooms" | "packages">("packages");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [guests, setGuests] = useState({ adults: 2, children: 0 });
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);

  const handleModeChange = (newMode: "rooms" | "packages") => {
    setMode(newMode);
    setSelectedRoom(null);
    setSelectedPackage(null);
    setSelectedDate(null);
    setSelectedAddOns([]);
  };

  const rooms = [
    { id: "shared-dorm", name: "Shared Dorm", type: "4-bed mixed dorm", price: 45, perks: "Locker, shared bath, AC", capacity: 1, available: true },
    { id: "private-room", name: "Private Room", type: "Double bed", price: 95, perks: "Private bath, ocean view, AC", capacity: 2, available: true },
    { id: "bungalow", name: "Beach Bungalow", type: "King bed + sofa", price: 165, perks: "Private terrace, outdoor shower, kitchen", capacity: 3, available: true },
    { id: "villa", name: "Surf Villa", type: "2 bedrooms", price: 280, perks: "Full kitchen, pool access, 4 guests max", capacity: 4, available: false },
  ];

  const packages = [
    {
      id: "weekend-intro", name: "Weekend Surf Intro", duration: "3 days / 2 nights", startDates: ["Dec 20", "Dec 27", "Jan 3"],
      price: 349, priceNote: "per person", spots: 6, level: "Beginner",
      includes: ["2 nights shared accommodation", "4 surf lessons (2hr each)", "Board & wetsuit rental", "Daily breakfast", "Airport transfer"],
    },
    {
      id: "week-intensive", name: "Week Surf Intensive", duration: "7 days / 6 nights", startDates: ["Dec 21", "Dec 28", "Jan 4"],
      price: 899, priceNote: "per person", spots: 4, level: "All Levels",
      includes: ["6 nights private room", "10 surf lessons", "Video analysis session", "Board & wetsuit rental", "All meals included", "Yoga classes", "Day trip excursion"],
    },
    {
      id: "retreat-wellness", name: "Surf & Wellness Retreat", duration: "5 days / 4 nights", startDates: ["Dec 22", "Jan 5", "Jan 12"],
      price: 1249, priceNote: "per person", spots: 8, level: "All Levels",
      includes: ["4 nights bungalow", "Daily surf sessions", "Daily yoga & meditation", "Spa treatment", "Organic meals", "Wellness workshops", "Sunset excursion"],
    },
  ];

  const addOns = [
    { id: "airport", name: "Airport Transfer", price: 35 },
    { id: "photo", name: "Photo/Video Package", price: 75 },
    { id: "massage", name: "Massage (60 min)", price: 65 },
    { id: "excursion", name: "Day Trip Excursion", price: 85 },
  ];

  const roomAddOns = [
    { id: "surf-lesson", name: "Surf Lesson (2hr)", price: 55 },
    { id: "yoga-class", name: "Yoga Class", price: 20 },
    { id: "board-rental", name: "Board Rental (day)", price: 25 },
  ];

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
  };

  const nights = 4;
  const totalGuests = guests.adults + guests.children;
  const selectedPackageData = packages.find((p) => p.id === selectedPackage);
  const selectedRoomData = rooms.find((r) => r.id === selectedRoom);
  const addOnsTotal = addOns.filter((a) => selectedAddOns.includes(a.id)).reduce((acc, a) => acc + a.price, 0);
  const roomAddOnsTotal = roomAddOns.filter((a) => selectedAddOns.includes(a.id)).reduce((acc, a) => acc + a.price, 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        <button
          onClick={() => handleModeChange("packages")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "packages" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Packages
        </button>
        <button
          onClick={() => handleModeChange("rooms")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "rooms" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Home className="h-4 w-4" />
          Rooms Only
        </button>
      </div>

      {mode === "packages" ? (
        <>
          <div className="space-y-3">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => { setSelectedPackage(pkg.id); setSelectedDate(null); }}
                className={`w-full p-4 rounded-lg border text-left transition-colors ${
                  selectedPackage === pkg.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{pkg.name}</p>
                      <Badge variant="outline" className="text-xs">{pkg.level}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{pkg.duration}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary text-lg">${pkg.price}</p>
                    <p className="text-xs text-muted-foreground">{pkg.priceNote}</p>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Includes:</p>
                  <div className="flex flex-wrap gap-1">
                    {pkg.includes.slice(0, 3).map((item, idx) => (
                      <span key={idx} className="text-xs bg-muted px-2 py-0.5 rounded">{item}</span>
                    ))}
                    {pkg.includes.length > 3 && (
                      <span className="text-xs text-primary font-medium">+{pkg.includes.length - 3} more</span>
                    )}
                  </div>
                </div>
                {selectedPackage === pkg.id && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Full inclusions:</p>
                    <ul className="grid grid-cols-1 gap-1">
                      {pkg.includes.map((item, idx) => (
                        <li key={idx} className="text-xs flex items-center gap-1.5">
                          <span className="h-1 w-1 bg-primary rounded-full" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </button>
            ))}
          </div>

          {selectedPackage && selectedPackageData && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Select Start Date</h4>
              <div className="grid grid-cols-3 gap-2">
                {selectedPackageData.startDates.map((date) => (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      selectedDate === date ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <p className="font-medium text-sm">{date}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedPackageData.spots} spots</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedDate && (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Number of Guests</h4>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <span className="text-sm">Participants</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setGuests({ ...guests, adults: Math.max(1, guests.adults - 1) })} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted">-</button>
                    <span className="font-medium w-4 text-center">{guests.adults}</span>
                    <button onClick={() => setGuests({ ...guests, adults: guests.adults + 1 })} className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-muted">+</button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Enhance Your Experience</h4>
                <div className="grid grid-cols-2 gap-2">
                  {addOns.map((addOn) => (
                    <button
                      key={addOn.id}
                      onClick={() => toggleAddOn(addOn.id)}
                      className={`p-2 rounded-lg border text-left transition-colors ${
                        selectedAddOns.includes(addOn.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-4 rounded border flex items-center justify-center ${selectedAddOns.includes(addOn.id) ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                          {selectedAddOns.includes(addOn.id) && <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                        <div>
                          <p className="text-xs font-medium">{addOn.name}</p>
                          <p className="text-xs text-primary">+${addOn.price}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{selectedPackageData?.name} × {guests.adults}</span>
                  <span>${(selectedPackageData?.price || 0) * guests.adults}</span>
                </div>
                {addOnsTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Add-ons</span>
                    <span>${addOnsTotal}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t">
                  <span className="font-medium">Total</span>
                  <span className="font-bold text-lg">${(selectedPackageData?.price || 0) * guests.adults + addOnsTotal}</span>
                </div>
              </div>
            </>
          )}

          <Button className="w-full" disabled={!selectedPackage || !selectedDate}>Book Package</Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 p-3 bg-muted/50 rounded-lg text-center">
            <div><p className="text-xs text-muted-foreground">Check-in</p><p className="font-medium">Dec 20</p></div>
            <div><p className="text-xs text-muted-foreground">Check-out</p><p className="font-medium">Dec 24</p></div>
            <div><p className="text-xs text-muted-foreground">Guests</p><p className="font-medium">{totalGuests}</p></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2">
              <span className="text-sm">Adults</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setGuests({ ...guests, adults: Math.max(1, guests.adults - 1) })} className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm">-</button>
                <span className="font-medium w-4 text-center">{guests.adults}</span>
                <button onClick={() => setGuests({ ...guests, adults: guests.adults + 1 })} className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm">+</button>
              </div>
            </div>
            <div className="flex items-center justify-between p-2">
              <span className="text-sm">Children</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setGuests({ ...guests, children: Math.max(0, guests.children - 1) })} className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm">-</button>
                <span className="font-medium w-4 text-center">{guests.children}</span>
                <button onClick={() => setGuests({ ...guests, children: guests.children + 1 })} className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-muted text-sm">+</button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Select Accommodation</h4>
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => room.available && setSelectedRoom(room.id)}
                disabled={!room.available}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  !room.available ? "opacity-50 cursor-not-allowed bg-muted/30" :
                  selectedRoom === room.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{room.name}</p>
                      {!room.available && <Badge variant="outline" className="text-xs">Sold out</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{room.type}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{room.perks}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-primary">${room.price}</p>
                    <p className="text-xs text-muted-foreground">/night</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedRoom && (
            <>
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Add Experiences (Optional)</h4>
                <div className="space-y-2">
                  {roomAddOns.map((exp) => (
                    <button
                      key={exp.id}
                      onClick={() => toggleAddOn(exp.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                        selectedAddOns.includes(exp.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`h-4 w-4 rounded border flex items-center justify-center ${selectedAddOns.includes(exp.id) ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                          {selectedAddOns.includes(exp.id) && <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                        <span className="font-medium text-sm">{exp.name}</span>
                      </div>
                      <span className="text-primary font-medium">+${exp.price}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{selectedRoomData?.name} × {nights} nights</span>
                  <span>${(selectedRoomData?.price || 0) * nights}</span>
                </div>
                {roomAddOnsTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Experiences</span>
                    <span>+${roomAddOnsTotal}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t">
                  <span className="font-medium">Total</span>
                  <span className="font-bold text-lg">${(selectedRoomData?.price || 0) * nights + roomAddOnsTotal}</span>
                </div>
              </div>
            </>
          )}

          <Button className="w-full" disabled={!selectedRoom}>Reserve Room</Button>
        </>
      )}
    </div>
  );
}

// =============================================================================
// ARCHETYPE 16: LAB BOOKING SYSTEM
// For: Research Labs, Maker Spaces, University Labs, Fab Labs, Biotech Facilities
// =============================================================================

function LabBookingTemplate() {
  const [mode, setMode] = useState<"equipment" | "workspace">("equipment");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [certificationConfirmed, setCertificationConfirmed] = useState(false);

  const handleModeChange = (newMode: "equipment" | "workspace") => {
    setMode(newMode);
    setSelectedEquipment(null);
    setSelectedWorkspace(null);
    setSelectedSlot(null);
    setCertificationConfirmed(false);
  };

  const equipment = [
    {
      id: "3d-printer",
      name: "3D Printer - Prusa MK4",
      category: "Fabrication",
      rate: "$15/hr",
      requiresCert: true,
      available: true,
    },
    {
      id: "laser-cutter",
      name: "Laser Cutter - 60W CO2",
      category: "Fabrication",
      rate: "$25/hr",
      requiresCert: true,
      available: true,
    },
    {
      id: "cnc-mill",
      name: "CNC Mill - Tormach PCNC",
      category: "Fabrication",
      rate: "$35/hr",
      requiresCert: true,
      available: false,
    },
    {
      id: "microscope",
      name: "Confocal Microscope",
      category: "Analysis",
      rate: "$50/hr",
      requiresCert: true,
      available: true,
    },
    {
      id: "spectrophotometer",
      name: "UV-Vis Spectrophotometer",
      category: "Analysis",
      rate: "$20/hr",
      requiresCert: false,
      available: true,
    },
  ];

  const workspaces = [
    {
      id: "wet-bench-a1",
      name: "Wet Lab Bench A1",
      type: "Wet Lab",
      features: ["Sink", "Gas line", "Fume hood access"],
      rate: "$12/hr",
      available: true,
    },
    {
      id: "wet-bench-a2",
      name: "Wet Lab Bench A2",
      type: "Wet Lab",
      features: ["Sink", "Gas line", "Fume hood access"],
      rate: "$12/hr",
      available: true,
    },
    {
      id: "dry-bench",
      name: "Dry Lab Workstation",
      type: "Dry Lab",
      features: ["Power strips", "Data ports", "Storage cabinet"],
      rate: "$8/hr",
      available: true,
    },
    {
      id: "electronics",
      name: "Electronics Bench",
      type: "Electronics",
      features: ["Oscilloscope", "Power supply", "Soldering station"],
      rate: "$10/hr",
      available: false,
    },
    {
      id: "cleanroom",
      name: "Clean Room Access",
      type: "Clean Room",
      features: ["Class 1000", "Gowning required", "Staff supervision"],
      rate: "$45/hr",
      available: true,
    },
  ];

  const timeSlots = [
    { id: "9-11", time: "9:00 AM - 11:00 AM", available: true },
    { id: "11-13", time: "11:00 AM - 1:00 PM", available: true },
    { id: "13-15", time: "1:00 PM - 3:00 PM", available: false },
    { id: "15-17", time: "3:00 PM - 5:00 PM", available: true },
    { id: "17-19", time: "5:00 PM - 7:00 PM", available: true },
  ];

  const selectedEquipmentData = equipment.find((e) => e.id === selectedEquipment);
  const selectedWorkspaceData = workspaces.find((w) => w.id === selectedWorkspace);
  const needsCertification = mode === "equipment" && selectedEquipmentData?.requiresCert;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        <button
          onClick={() => handleModeChange("equipment")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "equipment" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Layers className="h-4 w-4" />
          Equipment
        </button>
        <button
          onClick={() => handleModeChange("workspace")}
          className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            mode === "workspace" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Workspace
        </button>
      </div>

      {/* Date selection */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date() || date.getDay() === 0}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Equipment selection */}
      {selectedDate && mode === "equipment" && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Equipment</h4>
          <div className="space-y-2">
            {equipment.map((item) => (
              <button
                key={item.id}
                onClick={() => item.available && setSelectedEquipment(item.id)}
                disabled={!item.available}
                className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                  !item.available
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : selectedEquipment === item.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{item.name}</p>
                    {item.requiresCert && (
                      <Badge variant="outline" className="text-xs">
                        Cert Required
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{item.category}</p>
                </div>
                <div className="text-right">
                  <span className="text-primary font-semibold">{item.rate}</span>
                  {!item.available && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      In Use
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Workspace selection */}
      {selectedDate && mode === "workspace" && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Workspace</h4>
          <div className="space-y-2">
            {workspaces.map((space) => (
              <button
                key={space.id}
                onClick={() => space.available && setSelectedWorkspace(space.id)}
                disabled={!space.available}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  !space.available
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : selectedWorkspace === space.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{space.name}</p>
                    <p className="text-sm text-muted-foreground">{space.type}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {space.features.map((feature) => (
                        <span
                          key={feature}
                          className="text-xs bg-muted px-1.5 py-0.5 rounded"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-primary">{space.rate}</p>
                    {!space.available && (
                      <Badge variant="outline" className="text-xs mt-1">
                        Reserved
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Time slot selection */}
      {(selectedEquipment || selectedWorkspace) && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Select Time Slot</h4>
          <div className="space-y-2">
            {timeSlots.map((slot) => (
              <button
                key={slot.id}
                onClick={() => slot.available && setSelectedSlot(slot.id)}
                disabled={!slot.available}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  !slot.available
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : selectedSlot === slot.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span className={`font-medium ${!slot.available ? "line-through" : ""}`}>
                  {slot.time}
                </span>
                {!slot.available && (
                  <Badge variant="outline" className="text-xs">
                    Booked
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Safety certification checkbox */}
      {selectedSlot && needsCertification && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={certificationConfirmed}
              onChange={(e) => setCertificationConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-300"
            />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">Safety Certification Required</p>
              <p className="text-amber-700 dark:text-amber-300">
                I confirm I have completed the required safety training for this equipment.
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Booking summary */}
      {selectedSlot && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <span className="text-sm text-muted-foreground">
            {mode === "equipment" ? selectedEquipmentData?.name : selectedWorkspaceData?.name}
          </span>
          <span className="font-bold">
            {mode === "equipment" ? selectedEquipmentData?.rate : selectedWorkspaceData?.rate}
          </span>
        </div>
      )}

      <Button
        className="w-full"
        disabled={
          !selectedDate ||
          !selectedSlot ||
          (mode === "equipment" && !selectedEquipment) ||
          (mode === "workspace" && !selectedWorkspace) ||
          (needsCertification && !certificationConfirmed)
        }
      >
        {mode === "equipment" ? "Reserve Equipment" : "Reserve Workspace"}
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 17: LIBRARY SEAT RESERVATION
// For: Libraries, Study Spaces, Reading Rooms, University Libraries, Coworking Reading Areas
// =============================================================================

function LibrarySeatReservationTemplate() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);

  const durations = [
    { id: "2hr", label: "2 hours" },
    { id: "4hr", label: "4 hours" },
    { id: "full", label: "Full day" },
  ];

  const zones = [
    {
      id: "silent",
      name: "Silent Study Zone",
      floor: "3rd Floor",
      rules: "No talking, no phone calls",
      available: 12,
      total: 30,
      icon: "🤫",
    },
    {
      id: "quiet",
      name: "Quiet Study Area",
      floor: "2nd Floor",
      rules: "Low whispers OK",
      available: 24,
      total: 40,
      icon: "📚",
    },
    {
      id: "collaborative",
      name: "Collaborative Space",
      floor: "1st Floor",
      rules: "Group work welcome",
      available: 8,
      total: 20,
      icon: "👥",
    },
    {
      id: "computer",
      name: "Computer Lab",
      floor: "Ground Floor",
      rules: "Desktop PCs available",
      available: 5,
      total: 25,
      icon: "💻",
    },
    {
      id: "private",
      name: "Private Study Rooms",
      floor: "2nd Floor",
      rules: "2-4 person rooms, 2hr max",
      available: 2,
      total: 8,
      icon: "🚪",
    },
  ];

  const seatsByZone: Record<string, Array<{ id: string; name: string; features: string[]; available: boolean }>> = {
    silent: [
      { id: "3A-01", name: "Seat 3A-01", features: ["Window", "Power outlet"], available: true },
      { id: "3A-02", name: "Seat 3A-02", features: ["Power outlet"], available: true },
      { id: "3A-03", name: "Seat 3A-03", features: ["Window", "Natural light"], available: false },
      { id: "3B-01", name: "Seat 3B-01", features: ["Standing desk", "Power outlet"], available: true },
      { id: "3B-02", name: "Seat 3B-02", features: ["Extra large desk"], available: true },
    ],
    quiet: [
      { id: "2A-01", name: "Seat 2A-01", features: ["Power outlet", "Reading lamp"], available: true },
      { id: "2A-02", name: "Seat 2A-02", features: ["Window view"], available: true },
      { id: "2A-03", name: "Seat 2A-03", features: ["Near reference section"], available: true },
      { id: "2B-01", name: "Seat 2B-01", features: ["Booth seating", "Power outlet"], available: false },
    ],
    collaborative: [
      { id: "1-T1", name: "Table 1 (4 seats)", features: ["Whiteboard", "Screen sharing"], available: true },
      { id: "1-T2", name: "Table 2 (4 seats)", features: ["Whiteboard"], available: false },
      { id: "1-T3", name: "Table 3 (6 seats)", features: ["Large table", "Power strips"], available: true },
    ],
    computer: [
      { id: "G-PC01", name: "PC Station 01", features: ["Dual monitor", "Adobe Suite"], available: true },
      { id: "G-PC02", name: "PC Station 02", features: ["Dual monitor", "SPSS"], available: false },
      { id: "G-PC03", name: "PC Station 03", features: ["Single monitor", "Scanner access"], available: true },
      { id: "G-PC04", name: "PC Station 04", features: ["Accessibility station", "Screen reader"], available: true },
    ],
    private: [
      { id: "PR-01", name: "Room 201", features: ["4 person max", "Whiteboard", "Display"], available: true },
      { id: "PR-02", name: "Room 202", features: ["2 person max", "Quiet booth"], available: true },
      { id: "PR-03", name: "Room 203", features: ["4 person max", "Video conferencing"], available: false },
    ],
  };

  const selectedZoneData = zones.find((z) => z.id === selectedZone);
  const availableSeats = selectedZone ? seatsByZone[selectedZone] || [] : [];
  const selectedSeatData = availableSeats.find((s) => s.id === selectedSeat);

  return (
    <div className="space-y-4">
      {/* Date selection */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Select Date</h4>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date()}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Duration selection */}
      {selectedDate && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Session Duration</h4>
          <div className="grid grid-cols-3 gap-2">
            {durations.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDuration(d.id)}
                className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                  selectedDuration === d.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Zone selection */}
      {selectedDuration && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Choose Zone</h4>
          <div className="space-y-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                onClick={() => {
                  setSelectedZone(zone.id);
                  setSelectedSeat(null);
                }}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  selectedZone === zone.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{zone.icon}</span>
                    <div>
                      <p className="font-medium">{zone.name}</p>
                      <p className="text-sm text-muted-foreground">{zone.floor}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{zone.rules}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={zone.available <= 5 ? "destructive" : "secondary"}>
                      {zone.available} / {zone.total}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Seat selection */}
      {selectedZone && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Select Seat in {selectedZoneData?.name}
          </h4>
          <div className="grid gap-2">
            {availableSeats.map((seat) => (
              <button
                key={seat.id}
                onClick={() => seat.available && setSelectedSeat(seat.id)}
                disabled={!seat.available}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  !seat.available
                    ? "opacity-50 cursor-not-allowed bg-muted/30"
                    : selectedSeat === seat.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div>
                  <p className={`font-medium ${!seat.available ? "line-through" : ""}`}>
                    {seat.name}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {seat.features.map((feature) => (
                      <span
                        key={feature}
                        className="text-xs bg-muted px-1.5 py-0.5 rounded"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
                {!seat.available && (
                  <Badge variant="outline" className="text-xs">
                    Occupied
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Booking summary */}
      {selectedSeat && (
        <div className="p-3 bg-muted/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Zone</span>
            <span className="font-medium">{selectedZoneData?.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Seat</span>
            <span className="font-medium">{selectedSeatData?.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">
              {durations.find((d) => d.id === selectedDuration)?.label}
            </span>
          </div>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!selectedDate || !selectedDuration || !selectedZone || !selectedSeat}
      >
        Reserve Seat
      </Button>
    </div>
  );
}

// =============================================================================
// ARCHETYPE 17: CONTACT HUB
// For: SaaS, Enterprise Support, Product Companies, Service Businesses
// =============================================================================

function ContactHubTemplate() {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const requestTypes = [
    {
      id: "question",
      icon: HelpCircle,
      title: "I have a question",
      description: "Need help understanding something?",
    },
    {
      id: "feature",
      icon: Lightbulb,
      title: "Feature request",
      description: "Missing something? Tell us!",
    },
    {
      id: "bug",
      icon: Bug,
      title: "Report a bug",
      description: "Found something broken?",
    },
    {
      id: "pricing",
      icon: CreditCard,
      title: "Pricing & custom offers",
      description: "Need a custom plan or billing help?",
    },
    {
      id: "demo",
      icon: CalendarIcon,
      title: "Request a demo",
      description: "See the platform in action",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Choose what best describes your situation
        </h4>
        <div className="space-y-2">
          {requestTypes.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                  selectedType === type.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{type.title}</p>
                  <p className="text-xs text-muted-foreground">{type.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedType && ["question", "feature", "bug", "pricing"].includes(selectedType) && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground mb-2">
            {selectedType === "bug" ? "Describe the issue you encountered" : 
             selectedType === "pricing" ? "Tell us about your needs" : "Tell us more about your request"}
          </p>
          <div className="h-16 bg-background rounded border border-dashed border-border flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Form fields appear here</span>
          </div>
        </div>
      )}

      {selectedType === "demo" && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground mb-2">Schedule a time to talk</p>
          <div className="h-16 bg-background rounded border border-dashed border-border flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Calendar picker appears here</span>
          </div>
        </div>
      )}

      <Button className="w-full" disabled={!selectedType}>
        <Send className="h-4 w-4 mr-2" />
        {selectedType === "demo" ? "Continue to Scheduling" : "Submit Request"}
      </Button>

      <div className="text-center pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          Looking for answers? <span className="text-primary cursor-pointer hover:underline">Check our documentation</span>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// ARCHETYPE DEFAULTS & CONFIGURATION
// =============================================================================

interface BookingPageConfig {
  businessName: string;
  logoUrl?: string;
  heroImageUrl?: string;
  heroOverlayOpacity?: number;
  pageTitle?: string;
  description?: string;
}

interface ArchetypeDefaults {
  heroImage: string;
  title: string;
  description: string;
  category: string;
}

const ARCHETYPE_DEFAULTS: Record<string, ArchetypeDefaults> = {
  healthcare: {
    heroImage: "https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=600&h=200&fit=crop",
    title: "Book an Appointment",
    description: "Primary care, specialists, therapy, dental",
    category: "Healthcare",
  },
  beauty: {
    heroImage: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&h=200&fit=crop",
    title: "Book Your Visit",
    description: "Hair, nails, spa, wellness",
    category: "Beauty & Personal Care",
  },
  professional: {
    heroImage: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=200&fit=crop",
    title: "Schedule a Consultation",
    description: "Legal, financial, business advice",
    category: "Professional Services",
  },
  "home-service": {
    heroImage: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&h=200&fit=crop",
    title: "Request Service",
    description: "Repairs, maintenance, installations",
    category: "Home & Field Service",
  },
  "fitness-class": {
    heroImage: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600&h=200&fit=crop",
    title: "Join a Class",
    description: "Group fitness, yoga, strength training",
    category: "Fitness & Wellness",
  },
  workshop: {
    heroImage: "https://images.unsplash.com/photo-1556761175-b413da4baf72?w=600&h=200&fit=crop",
    title: "Enroll Now",
    description: "Learn new skills, creative workshops",
    category: "Education & Training",
  },
  tour: {
    heroImage: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&h=200&fit=crop",
    title: "Book Your Adventure",
    description: "Tours, tastings, unique experiences",
    category: "Tours & Experiences",
  },
  workspace: {
    heroImage: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=600&h=200&fit=crop",
    title: "Reserve Your Space",
    description: "Desks, offices, meeting rooms",
    category: "Workspace & Coworking",
  },
  sports: {
    heroImage: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=200&fit=crop",
    title: "Book a Court",
    description: "Courts, pools, fields, facilities",
    category: "Sports & Recreation",
  },
  venue: {
    heroImage: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=600&h=200&fit=crop",
    title: "Plan Your Event",
    description: "Weddings, parties, corporate gatherings",
    category: "Event Venues",
  },
  studio: {
    heroImage: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=600&h=200&fit=crop",
    title: "Book Studio Time",
    description: "Photo, video, recording, podcast",
    category: "Creative Studios",
  },
  accommodation: {
    heroImage: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=200&fit=crop",
    title: "Book Your Stay",
    description: "Hotels, vacation rentals, retreats",
    category: "Accommodation",
  },
  equipment: {
    heroImage: "https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=600&h=200&fit=crop",
    title: "Rent Equipment",
    description: "Gear, tools, party supplies",
    category: "Equipment Rental",
  },
  entertainment: {
    heroImage: "https://images.unsplash.com/photo-1511882150382-421056c89033?w=600&h=200&fit=crop",
    title: "Book Your Experience",
    description: "Escape rooms, gaming, karaoke",
    category: "Entertainment",
  },
  "multi-location": {
    heroImage: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&h=200&fit=crop",
    title: "Find a Location",
    description: "Multiple convenient locations",
    category: "Multi-Location",
  },
  "classes-private": {
    heroImage: "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=600&h=200&fit=crop",
    title: "Book a Session",
    description: "Group classes or private instruction",
    category: "Hybrid: Classes + Private",
  },
  "accommodation-packages": {
    heroImage: "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=600&h=200&fit=crop",
    title: "Plan Your Trip",
    description: "Stays with bundled experiences",
    category: "Hybrid: Stay + Experience",
  },
  lab: {
    heroImage: "https://images.unsplash.com/photo-1582719471384-894fbb16e074?w=600&h=200&fit=crop",
    title: "Reserve Lab Resources",
    description: "Equipment, workspaces & facilities",
    category: "Research & Lab",
  },
  library: {
    heroImage: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=600&h=200&fit=crop",
    title: "Reserve a Seat",
    description: "Study spaces, reading rooms & computer labs",
    category: "Library",
  },
  "contact-hub": {
    heroImage: "https://images.unsplash.com/photo-1423666639041-f56000c27a9a?w=600&h=200&fit=crop",
    title: "We're Here to Help",
    description: "Questions, feedback, demos & support",
    category: "Support & Communication",
  },
};

// =============================================================================
// HERO BANNER COMPONENT
// =============================================================================

function HeroBanner({ 
  config, 
  defaultImage 
}: { 
  config: BookingPageConfig; 
  defaultImage: string;
}) {
  return (
    <div className="relative h-48 w-full overflow-hidden rounded-t-xl">
      {/* Hero Image with fallback */}
      <img
        src={config.heroImageUrl || defaultImage}
        alt=""
        className="h-full w-full object-cover"
      />
      
      {/* Overlay for text readability */}
      <div 
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent"
        style={{ opacity: (config.heroOverlayOpacity ?? 80) / 100 }}
      />
      
      {/* Business branding positioned over image */}
      <div className="absolute bottom-4 left-4 right-4 text-white">
        {config.logoUrl ? (
          <img 
            src={config.logoUrl} 
            alt={config.businessName} 
            className="h-10 drop-shadow-lg" 
          />
        ) : (
          <h1 className="text-xl font-bold drop-shadow-lg">{config.businessName}</h1>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// BOOKING HEADER COMPONENT
// =============================================================================

function BookingHeader({ 
  config, 
  archetypeDefaults 
}: { 
  config: BookingPageConfig;
  archetypeDefaults: ArchetypeDefaults;
}) {
  return (
    <div className="space-y-1.5 p-4 pb-2">
      {/* Category badge */}
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {archetypeDefaults.category}
      </span>
      
      {/* Page title - business can override */}
      <h2 className="text-xl font-semibold">
        {config.pageTitle || archetypeDefaults.title}
      </h2>
      
      {/* Description - business can override archetype default */}
      <p className="text-sm text-muted-foreground">
        {config.description || archetypeDefaults.description}
      </p>
    </div>
  );
}

// =============================================================================
// ARCHETYPE WRAPPER COMPONENT
// =============================================================================

function ArchetypeWrapper({ 
  config, 
  archetypeType,
  children 
}: { 
  config: BookingPageConfig;
  archetypeType: string;
  children: React.ReactNode;
}) {
  const defaults = ARCHETYPE_DEFAULTS[archetypeType] || {
    heroImage: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=200&fit=crop",
    title: "Book Now",
    description: "Schedule your appointment",
    category: "Services",
  };
  
  return (
    <Card className="overflow-hidden">
      <HeroBanner config={config} defaultImage={defaults.heroImage} />
      <BookingHeader config={config} archetypeDefaults={defaults} />
      <CardContent className="pt-2">
        {children}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// ARCHETYPE DATA
// =============================================================================

const archetypes = [
  {
    id: "healthcare",
    name: "Healthcare Appointment",
    icon: Stethoscope,
    component: HealthcareAppointmentTemplate,
    categoryGroup: "1:1 Services",
    config: {
      businessName: "Sunrise Medical Center",
      pageTitle: "Book an Appointment",
      description: "Primary care, specialists & wellness visits",
    },
  },
  {
    id: "beauty",
    name: "Beauty & Personal Care",
    icon: Scissors,
    component: BeautyPersonalCareTemplate,
    categoryGroup: "1:1 Services",
    config: {
      businessName: "Luxe Beauty Studio",
      pageTitle: "Book Your Visit",
      description: "Hair, nails, skincare & spa treatments",
    },
  },
  {
    id: "professional",
    name: "Professional Consultation",
    icon: Briefcase,
    component: ProfessionalConsultationTemplate,
    categoryGroup: "1:1 Services",
    config: {
      businessName: "Sterling & Associates",
      pageTitle: "Schedule a Consultation",
      description: "Legal, financial & business advisory",
    },
  },
  {
    id: "home-service",
    name: "Home & Field Service",
    icon: Wrench,
    component: HomeFieldServiceTemplate,
    categoryGroup: "1:1 Services",
    config: {
      businessName: "HomeFixPro Services",
      pageTitle: "Request Service",
      description: "Plumbing, electrical, HVAC & repairs",
    },
  },
  {
    id: "fitness-class",
    name: "Fitness & Studio Class",
    icon: Dumbbell,
    component: FitnessStudioClassTemplate,
    categoryGroup: "Classes & Events",
    config: {
      businessName: "Core Fitness Studio",
      pageTitle: "Join a Class",
      description: "Yoga, HIIT, spin & strength training",
    },
  },
  {
    id: "workshop",
    name: "Workshop & Course",
    icon: GraduationCap,
    component: WorkshopCourseTemplate,
    categoryGroup: "Classes & Events",
    config: {
      businessName: "Creative Workshop Hub",
      pageTitle: "Enroll Now",
      description: "Art, cooking, photography & more",
    },
  },
  {
    id: "tour",
    name: "Tour & Experience",
    icon: Compass,
    component: TourExperienceTemplate,
    categoryGroup: "Classes & Events",
    config: {
      businessName: "Wanderlust Adventures",
      pageTitle: "Book Your Adventure",
      description: "City tours, tastings & excursions",
    },
  },
  {
    id: "workspace",
    name: "Workspace & Meeting Room",
    icon: Building2,
    component: WorkspaceMeetingRoomTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "FlexSpace Co-Working",
      pageTitle: "Reserve Your Space",
      description: "Hot desks, offices & conference rooms",
    },
  },
  {
    id: "sports",
    name: "Sports Facility",
    icon: Dumbbell,
    component: SportsFacilityTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Premier Sports Club",
      pageTitle: "Book a Court",
      description: "Tennis, basketball, pool & fitness",
    },
  },
  {
    id: "venue",
    name: "Event Venue",
    icon: Ticket,
    component: EventVenueTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Grand Events Hall",
      pageTitle: "Plan Your Event",
      description: "Weddings, parties & corporate events",
    },
  },
  {
    id: "studio",
    name: "Creative Studio",
    icon: Camera,
    component: CreativeStudioTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Aperture Studios",
      pageTitle: "Book Studio Time",
      description: "Photo, video & podcast recording",
    },
  },
  {
    id: "accommodation",
    name: "Accommodation",
    icon: Tent,
    component: AccommodationTemplate,
    categoryGroup: "Stays & Rentals",
    config: {
      businessName: "Serene Stays Resort",
      pageTitle: "Book Your Stay",
      description: "Rooms, suites & vacation rentals",
    },
  },
  {
    id: "equipment",
    name: "Equipment Rental",
    icon: Package,
    component: EquipmentRentalTemplate,
    categoryGroup: "Stays & Rentals",
    config: {
      businessName: "GearUp Rentals",
      pageTitle: "Rent Equipment",
      description: "Cameras, tools & party supplies",
    },
  },
  {
    id: "entertainment",
    name: "Entertainment Venue",
    icon: Ticket,
    component: EntertainmentVenueTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Escape Reality Games",
      pageTitle: "Book Your Experience",
      description: "Escape rooms, VR & karaoke",
    },
  },
  {
    id: "multi-location",
    name: "Multi-Location Service",
    icon: MapPin,
    component: MultiLocationServiceTemplate,
    categoryGroup: "1:1 Services",
    config: {
      businessName: "CityWide Dental",
      pageTitle: "Find a Location",
      description: "5 convenient locations near you",
    },
  },
  {
    id: "classes-private",
    name: "Classes + Private Sessions",
    icon: Dumbbell,
    component: ClassesAndPrivateSessionsTemplate,
    categoryGroup: "Hybrid",
    config: {
      businessName: "Zen Flow Yoga",
      pageTitle: "Book a Session",
      description: "Group classes or private instruction",
    },
  },
  {
    id: "accommodation-packages",
    name: "Accommodation + Packages",
    icon: Waves,
    component: AccommodationAndPackagesTemplate,
    categoryGroup: "Hybrid",
    config: {
      businessName: "Pacific Surf Camp",
      pageTitle: "Plan Your Trip",
      description: "Stays with surf lessons & experiences",
    },
  },
  {
    id: "lab",
    name: "Lab Booking System",
    icon: Microscope,
    component: LabBookingTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Innovation Research Lab",
      pageTitle: "Reserve Lab Resources",
      description: "Equipment, benches & clean room access",
    },
  },
  {
    id: "library",
    name: "Library Seat Reservation",
    icon: BookOpen,
    component: LibrarySeatReservationTemplate,
    categoryGroup: "Resources & Spaces",
    config: {
      businessName: "Central University Library",
      pageTitle: "Reserve a Seat",
      description: "Study spaces, computer labs & reading rooms",
    },
  },
  {
    id: "contact-hub",
    name: "Contact Hub",
    icon: MessageSquare,
    component: ContactHubTemplate,
    categoryGroup: "Support & Communication",
    config: {
      businessName: "Acme Support",
      pageTitle: "We're Here to Help",
      description: "Questions, feedback, demos & bug reports",
    },
  },
];

// Group archetypes by category
const categories = [
  { id: "1:1 Services", label: "1:1 Service Appointments" },
  { id: "Classes & Events", label: "Classes & Group Events" },
  { id: "Resources & Spaces", label: "Resources & Spaces" },
  { id: "Stays & Rentals", label: "Stays & Rentals" },
  { id: "Hybrid", label: "Hybrid Archetypes" },
  { id: "Support & Communication", label: "Support & Communication" },
];

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function OpusArchetypesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl mx-auto py-12 px-4">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">Booking Archetypes</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the template that best matches your business. Each archetype is designed for
            specific industries and booking patterns.
          </p>
        </div>

        {categories.map((category) => (
          <div key={category.id} className="mb-12">
            <h2 className="text-2xl font-semibold mb-6">{category.label}</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {archetypes
                .filter((a) => a.categoryGroup === category.id)
                .map((archetype) => {
                  const Template = archetype.component;
                  return (
                    <ArchetypeWrapper
                      key={archetype.id}
                      config={archetype.config}
                      archetypeType={archetype.id}
                    >
                      <Template />
                    </ArchetypeWrapper>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
