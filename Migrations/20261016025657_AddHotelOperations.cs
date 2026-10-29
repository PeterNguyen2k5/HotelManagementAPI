using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddHotelOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CurrentRoomSince",
                table: "Bookings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Revision",
                table: "Bookings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Actor = table.Column<string>(type: "TEXT", nullable: false),
                    Role = table.Column<string>(type: "TEXT", nullable: false),
                    Action = table.Column<string>(type: "TEXT", nullable: false),
                    Entity = table.Column<string>(type: "TEXT", nullable: false),
                    EntityId = table.Column<string>(type: "TEXT", nullable: false),
                    Summary = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BookingInvoices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    BookingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Number = table.Column<string>(type: "TEXT", nullable: false),
                    IssuedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Snapshot = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingInvoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingInvoices_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BookingPayments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    BookingId = table.Column<int>(type: "INTEGER", nullable: false),
                    RequestId = table.Column<string>(type: "TEXT", nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    Method = table.Column<string>(type: "TEXT", nullable: false),
                    Amount = table.Column<long>(type: "INTEGER", nullable: false),
                    Reference = table.Column<string>(type: "TEXT", nullable: true),
                    RecordedBy = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingPayments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingPayments_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BookingRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    BookingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Type = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    BookingRevision = table.Column<int>(type: "INTEGER", nullable: false),
                    RoomId = table.Column<int>(type: "INTEGER", nullable: true),
                    CheckInDate = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CheckOutDate = table.Column<DateTime>(type: "TEXT", nullable: true),
                    Reason = table.Column<string>(type: "TEXT", nullable: false),
                    StaffNote = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    ResolvedBy = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingRequests_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DatabaseBackups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    FileName = table.Column<string>(type: "TEXT", nullable: false),
                    Size = table.Column<long>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    CreatedBy = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DatabaseBackups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RoomCharges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    BookingId = table.Column<int>(type: "INTEGER", nullable: false),
                    RoomNumber = table.Column<string>(type: "TEXT", nullable: false),
                    StartDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    EndDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Nights = table.Column<int>(type: "INTEGER", nullable: false),
                    UnitPrice = table.Column<long>(type: "INTEGER", nullable: false),
                    Total = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomCharges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RoomCharges_Bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "Bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_CreatedAt",
                table: "AuditLogs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_BookingInvoices_BookingId",
                table: "BookingInvoices",
                column: "BookingId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingPayments_BookingId",
                table: "BookingPayments",
                column: "BookingId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingPayments_RequestId",
                table: "BookingPayments",
                column: "RequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingRequests_BookingId",
                table: "BookingRequests",
                column: "BookingId",
                unique: true,
                filter: "Status = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_RoomCharges_BookingId",
                table: "RoomCharges",
                column: "BookingId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropTable(
                name: "BookingInvoices");

            migrationBuilder.DropTable(
                name: "BookingPayments");

            migrationBuilder.DropTable(
                name: "BookingRequests");

            migrationBuilder.DropTable(
                name: "DatabaseBackups");

            migrationBuilder.DropTable(
                name: "RoomCharges");

            migrationBuilder.DropColumn(
                name: "CurrentRoomSince",
                table: "Bookings");

            migrationBuilder.DropColumn(
                name: "Revision",
                table: "Bookings");
        }
    }
}
